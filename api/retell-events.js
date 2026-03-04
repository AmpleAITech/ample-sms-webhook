// api/retell-events.js
// PURPOSE (Huron demo):
// Retell webhook helper to trigger the missed-call menu SMS ONLY when the call was a "quick hangup".
// We DO NOT forward voice data to Google Sheets in this Huron demo.

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

    // Demo assist: treat quick hangup as missed call (to reliably show missed-call SMS on demos)
    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 15;

    if (!isQuickHangup) {
      return res.status(200).json({ ok: true, done: true, isQuickHangup: false });
    }

    if (!fromNumber) return res.status(200).json({ ok: true, ignored: "missing_from_number" });
    if (!callId) return res.status(200).json({ ok: true, ignored: "missing_call_id" });

    // Optional dedupe (fail-open)
    const dedupeBase = process.env.DEDUPE_WEBHOOK_URL || "";
    if (dedupeBase) {
      const dedupeUrl = `${dedupeBase}?action=dedupe_menu&call_id=${encodeURIComponent(callId)}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);

        const dedupeResp = await fetch(dedupeUrl, { method: "GET", signal: controller.signal });
        clearTimeout(timeout);

        const raw = await dedupeResp.text();
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.allow === false) return res.status(200).json({ ok: true, ignored: "deduped" });
        } catch (_) {
          // fail open
        }
      } catch (_) {
        // fail open
      }
    }

    // Send menu SMS via Twilio
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Care";

    const menuText =
      `Sorry we missed you at ${clinicName}.\n` +
      `Reply with ONE of these (example: 1A):\n` +
      `1A = Book New Patient Exam (Location A)\n` +
      `1B = Book New Patient Exam (Location B)\n` +
      `2A = Reschedule (48h notice) - Location A\n` +
      `2B = Reschedule (48h notice) - Location B\n` +
      `3A = Other - Location A\n` +
      `3B = Other - Location B`;

    await client.messages.create({ from: TWILIO_FROM_NUMBER, to: fromNumber, body: menuText });

    return res.status(200).json({ ok: true, sms_sent: true, isQuickHangup: true });
  } catch (err) {
    // Demo-safe: always 200 so webhook doesn't retry forever
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
