// api/retell-events.js
// Receives Retell webhook events.
// If call ended quickly (<= 6s), send "Sorry we missed you..." SMS via Twilio.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};

    // --- You may need to adjust these field names based on Retell's payload ---
    // We'll handle several likely shapes to be safe.
    const type = String(event.event || event.type || "").toLowerCase();

    // Pull call info from common locations
    const call = event.call || event.data || event;
    const from = call.from_number || call.from || call.caller_number || call.phone_number || "";
    const duration =
      Number(call.duration_seconds ?? call.duration ?? call.call_duration ?? 0);

    // Only act on call end/completed events (defensive)
    const looksLikeCallEnd =
      type.includes("call") && (type.includes("end") || type.includes("completed") || type.includes("finish")) ||
      Boolean(call.duration_seconds ?? call.call_duration ?? call.duration);

    if (!looksLikeCallEnd) return res.status(200).json({ ok: true, ignored: "not_call_end" });

    // Simulated missed call: ended quickly
    if (!(duration > 0 && duration <= 6)) {
      return res.status(200).json({ ok: true, ignored: "duration_not_missed", duration });
    }

    if (!from) return res.status(200).json({ ok: true, ignored: "missing_from" });

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER; // should be +14313405041

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

    // Optional: log to sheet that menu SMS was sent
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
          notes: `Retell duration=${duration}`,
          call_sid: call.call_id || call.id || ""
        })
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, sms_sent: true, duration });
  } catch (err) {
    // Demo-safe: always return 200 so Retell doesn't retry endlessly
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
