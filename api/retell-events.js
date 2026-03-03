import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const eventType = String(event.event || event.type || "").toLowerCase();

    // Only act on call end/analyzed events (prevents duplicate sends)
    const shouldProcess = eventType === "call_ended" || eventType === "call_analyzed";
    if (!shouldProcess) return res.status(200).json({ ok: true, ignored: eventType });

    const call = event.call || event.data || event.payload || event;

    // Caller number
    const from =
      call?.from_number ||
      call?.from ||
      call?.caller_number ||
      call?.caller ||
      call?.phone_number ||
      call?.customer_number ||
      event?.from_number ||
      event?.from ||
      "";

    // Duration (Retell may use different keys; we try several)
    const duration = Number(
      call?.duration_seconds ??
      call?.duration ??
      call?.call_duration ??
      event?.duration_seconds ??
      0
    );

    // Simulated missed call: short calls only
    if (!(duration > 0 && duration <= 6)) {
      return res.status(200).json({ ok: true, ignored: "duration_not_missed", duration });
    }

    if (!from) return res.status(200).json({ ok: true, ignored: "missing_from" });

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

    return res.status(200).json({ ok: true, sms_sent: true, duration, eventType });
  } catch (err) {
    // demo-safe
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
