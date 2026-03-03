// api/retell-events.js
// FINAL: Voice -> Sheets forwarding + Missed-call -> single menu SMS (deduped)
// GUARANTEE: Missed-call behavior is unaffected because voice-forwarding is disabled when isQuickHangup=true.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const call = event.call || event.data || event.payload || event;

    // Only act on ended calls
    const callStatus = String(call?.call_status || "").toLowerCase();
    if (callStatus !== "ended") {
      return res.status(200).json({ ok: true, ignored: "not_ended", callStatus });
    }

    // Common call metadata
    const callId = String(call?.call_id || "").trim();
    const fromNumber = String(call?.from_number || "").trim();
    const disconnectionReason = String(call?.disconnection_reason || "").toLowerCase();

    const durationSeconds = Number(
      call?.call_cost?.total_duration_seconds ??
        (call?.duration_ms ? Math.round(Number(call.duration_ms) / 1000) : 0)
    );

    const recordingUrl = String(call?.recording_url || "").trim();
    const callSid = String(call?.telephony_identifier?.twilio_call_sid || "").trim();

    // -----------------------------
    // Missed call detection (used to guard voice forwarding)
    // -----------------------------
    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 15;

    // -----------------------------
    // Helper: safely pull extracted fields (Retell nesting can vary)
    // We search deeply for these exact keys you created.
    // -----------------------------
    function findValueDeep(obj, key) {
      if (!obj || typeof obj !== "object") return "";
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const v = obj[key];
        if (v !== null && v !== undefined && String(v).trim() !== "") return String(v).trim();
      }
      for (const k of Object.keys(obj)) {
        const child = obj[k];
        if (child && typeof child === "object") {
          const found = findValueDeep(child, key);
          if (found) return found;
        }
      }
      return "";
    }

    // Extract fields (these match your Retell post-call extraction fields)
    const extractedScenario = findValueDeep(call, "scenario") || findValueDeep(event, "scenario");
    const extractedFirst = findValueDeep(call, "first_name") || findValueDeep(event, "first_name");
    const extractedLast = findValueDeep(call, "last_name") || findValueDeep(event, "last_name");
    const extractedPhone =
      findValueDeep(call, "phone") || findValueDeep(event, "phone") || fromNumber;
    const extractedReason =
      findValueDeep(call, "reason_for_appointment") ||
      findValueDeep(event, "reason_for_appointment");
    const extractedConsent = findValueDeep(call, "consent") || findValueDeep(event, "consent");
    const extractedUrgent =
      findValueDeep(call, "urgent_flag") || findValueDeep(event, "urgent_flag");
    const extractedNotes = findValueDeep(call, "notes") || findValueDeep(event, "notes");

    // Normalize voice scenario into your demo labels
    const scRaw = String(extractedScenario || "").trim().toLowerCase();
    const scenarioMap = {
      new_patient: "telephone_request",
      "new patient": "telephone_request",
      telephone_request: "telephone_request",
      telephone_appointment_request: "telephone_request",
      "telephone appointment request": "telephone_request",

      reschedule: "reschedule_request",
      reschedule_request: "reschedule_request",
      "change appointment": "reschedule_request",
      cancel: "reschedule_request",
      "cancel request": "reschedule_request",
    };
    const normalizedVoiceScenario = scenarioMap[scRaw] || "";

    // -----------------------------
    // (A) VOICE → SHEETS FORWARDING
    // Never runs for missed-call quick hangups
    // -----------------------------
    const isConversation = durationSeconds >= 8;

    if (!isQuickHangup && isConversation && normalizedVoiceScenario) {
      try {
        await fetch("https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "phone",
            scenario: normalizedVoiceScenario,
            first_name: extractedFirst,
            last_name: extractedLast,
            phone: extractedPhone,
            email: "", // intake handler fills placeholder silently
            gender: "",
            reason_for_appointment: extractedReason,
            consent: extractedConsent, // intake normalizes (sms_yes/verbal_yes etc)
            urgent_flag: extractedUrgent || "no",
            notes: extractedNotes,
            call_sid: callSid,
            recording_url: recordingUrl,
          }),
        });
      } catch (_) {
        // demo-safe: ignore forwarding errors
      }

      // If this was a normal voice call, we can stop here to avoid any SMS menu logic.
      return res.status(200).json({ ok: true, forwarded: true, scenario: normalizedVoiceScenario });
    }

    // -----------------------------
    // (B) MISSED CALL → MENU SMS
    // -----------------------------
    if (!isQuickHangup) {
      return res.status(200).json({ ok: true, done: true });
    }

    if (!fromNumber) return res.status(200).json({ ok: true, ignored: "missing_from_number" });
    if (!callId) return res.status(200).json({ ok: true, ignored: "missing_call_id" });

    // DEDUPE (GET) - FAIL OPEN
    const dedupeBase = process.env.BESTCARE_DEDUPE_WEBHOOK_URL;
    if (!dedupeBase) {
      return res.status(500).json({ ok: false, error: "Missing BESTCARE_DEDUPE_WEBHOOK_URL" });
    }

    const dedupeUrl = `${dedupeBase}?action=dedupe_menu&call_id=${encodeURIComponent(callId)}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      const dedupeResp = await fetch(dedupeUrl, { method: "GET", signal: controller.signal });
      clearTimeout(timeout);

      const raw = await dedupeResp.text();
      try {
        const parsed = JSON.parse(raw);
        if (!parsed.allow) return res.status(200).json({ ok: true, ignored: "deduped" });
      } catch (_) {
        // non-JSON: fail open
      }
    } catch (_) {
      // fail open
    }

    // Send menu SMS via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromSms) {
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
    }

    const client = twilio(accountSid, authToken);

    const menuText =
      "Sorry we missed you at Best Care Medical Centre.\n" +
      "Please reply with 1, 2, or 3 only:\n" +
      "1 = Book a telephone appointment\n" +
      "2 = Change an existing appointment\n" +
      "3 = Other";

    await client.messages.create({ from: fromSms, to: fromNumber, body: menuText });

    return res.status(200).json({ ok: true, sms_sent: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
