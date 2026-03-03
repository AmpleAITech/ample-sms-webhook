// api/retell-events.js
// Retell webhook -> send missed-call SMS menu via Twilio
// DEMO-SAFE: send SMS on any "call ended" event (no duration filtering yet)

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};

    // --- Only act on call-ended events ---
    const eventType = String(event.event || event.type || "").toLowerCase();
    const isCallEnded = eventType.includes("call") && eventType.includes("end");
    if (!isCallEnded) {
      return res.status(200).json({ ok: true, ignored: "not_call_ended", eventType });
    }

    // --- Extract caller number from multiple possible locations ---
    const call = event.call || event.data || event.payload || event;

    const from =
      call.from_number ||
      call.from ||
      call.caller_number ||
      call.caller ||
      call.phone_number ||
      event.from_number ||
      event.from ||
      "";

    if (!from) {
      return res.status(200).json({ ok: true, ignored: "missing_from" });
    }

    // --- Twilio creds ---
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER; // MUST be +14313405041

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

    // Optional: log to sheet that menu was sent (nice for demo)
    try {
      await fetch("https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "phone",
          scenario: "missed_call",
          phone: from,
          reason_for_appointment: "Retell call ended — auto SMS menu sent",
          consent: "n/a",
          urgent_flag: "no",
          notes: `Retell eventType=${eventType}`,
          call_sid: call.call_id || call.id || ""
        })
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, sms_sent: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
