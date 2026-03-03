// api/retell-events.js
// Retell webhook -> send missed-call SMS menu via Twilio, exactly once per call.
// Uses Apps Script dedupe (CacheService + LockService) keyed by call_id.
//
// Requirements (Vercel env vars):
// - TWILIO_ACCOUNT_SID
// - TWILIO_AUTH_TOKEN
// - TWILIO_FROM_NUMBER = +14313405041
// - BESTCARE_DEDUPE_WEBHOOK_URL = https://script.google.com/macros/s/.../exec
//
// Retell payload fields confirmed from your RETELL_CALL:
// - call.call_id
// - call.call_status ("ended")
// - call.from_number
// - call.disconnection_reason ("user_hangup")
// - call.call_cost.total_duration_seconds
// - call.duration_ms
// - call.recording_url
// - call.telephony_identifier.twilio_call_sid

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const call = event.call || event.data || event.payload || event;

    // Only handle ended calls (robust to event naming)
    const callStatus = String(call?.call_status || "").toLowerCase();
    if (callStatus !== "ended") {
      return res.status(200).json({ ok: true, ignored: "not_ended", callStatus });
    }

    const callId = String(call?.call_id || "").trim();
    const from = String(call?.from_number || "").trim();
    const disconnectionReason = String(call?.disconnection_reason || "").toLowerCase();

    const durationSeconds = Number(
      call?.call_cost?.total_duration_seconds ??
      (call?.duration_ms ? Math.round(Number(call.duration_ms) / 1000) : 0)
    );

    // Simulated missed call: user hangs up quickly (<=6s)
    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 6;

    if (!isQuickHangup) {
      return res.status(200).json({
        ok: true,
        ignored: "not_quick_hangup",
        disconnectionReason,
        durationSeconds
      });
    }

    if (!callId) return res.status(200).json({ ok: true, ignored: "missing_call_id" });
    if (!from) return res.status(200).json({ ok: true, ignored: "missing_from_number" });

    // ---- DEDUPE (shared, reliable) ----
    const dedupeUrl = process.env.BESTCARE_DEDUPE_WEBHOOK_URL;
    if (!dedupeUrl) {
      return res.status(500).json({ ok: false, error: "Missing BESTCARE_DEDUPE_WEBHOOK_URL" });
    }

    const dedupeResp = await fetch(dedupeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "dedupe_menu", call_id: callId })
    });

    const dedupeJson = await dedupeResp.json().catch(() => ({}));
    if (!dedupeJson.allow) {
      return res.status(200).json({ ok: true, ignored: "deduped", reason: dedupeJson.reason || "duplicate" });
    }

    // ---- SEND MENU SMS ----
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER; // +14313405041

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

    await client.messages.create({
      from: fromSms,
      to: from,
      body: menuText
    });

    // ---- OPTIONAL: log menu-sent to your sheet (nice for demo) ----
    try {
      await fetch("https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "phone",
          scenario: "missed_call",
          phone: from,
          reason_for_appointment: "Simulated missed call (quick hangup) — auto SMS menu sent",
          consent: "n/a",
          urgent_flag: "no",
          notes: `call_id=${callId} duration=${durationSeconds}s`,
          call_sid: call?.telephony_identifier?.twilio_call_sid || "",
          recording_url: call?.recording_url || ""
        })
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, sms_sent: true, to: from, callId, durationSeconds });

  } catch (err) {
    // demo-safe: never cause retries
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
