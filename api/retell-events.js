// api/retell-events.js
// TEMP "works no matter what" version:
// - Only processes call_ended (avoids duplicates)
// - Sends the menu SMS to the caller if we can extract their number
// - If caller number is missing, falls back to DEBUG_TO_NUMBER (so you can still demo)
// - NO duration filter yet (we'll add back once we confirm Retell duration field)

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const eventType = String(event.event || event.type || "").toLowerCase();

    // Only act on call_ended to prevent multiple sends
    if (eventType !== "call_ended") {
      return res.status(200).json({ ok: true, ignored: eventType });
    }

    const call = event.call || event.data || event.payload || event;

    // Try to find caller number across common keys
    const from =
      call?.from_number ||
      call?.from ||
      call?.caller_number ||
      call?.caller ||
      call?.phone_number ||
      call?.customer_number ||
      event?.from_number ||
      event?.from ||
      event?.caller_number ||
      "";

    // Fallback for demo/debug (set this env var)
    const debugTo = process.env.DEBUG_TO_NUMBER || "";
    const to = from || debugTo;

    if (!to) {
      return res.status(200).json({ ok: true, ignored: "no_to_number_found" });
    }

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
      to,
      body: menuText,
    });

    // Optional: log that menu SMS was sent (helps demo)
    try {
      await fetch("https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "phone",
          scenario: "missed_call",
          phone: to,
          reason_for_appointment: "Retell call ended — auto SMS menu sent",
          consent: "n/a",
          urgent_flag: "no",
          notes: `eventType=${eventType} | used_to=${to === from ? "caller" : "debug_fallback"}`,
          call_sid: call?.call_id || call?.id || "",
        }),
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, sms_sent: true, to_used: to, to_source: to === from ? "caller" : "debug" });
  } catch (err) {
    // demo-safe: always return 200 to avoid retries
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
