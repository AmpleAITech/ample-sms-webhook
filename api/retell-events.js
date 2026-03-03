import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const event = req.body || {};

  // Log enough to see payload shape (first 1200 chars)
  console.log("RETELL_EVENT", JSON.stringify(event).slice(0, 1200));

  try {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER; // +14313405041

    if (!accountSid || !authToken || !fromSms) {
      console.log("MISSING_TWILIO_ENV");
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
    }

    // Try hard to find a phone number in the payload
    const call = event.call || event.data || event.payload || event;
    const possible = [
      call?.from_number,
      call?.from,
      call?.caller_number,
      call?.caller,
      call?.phone_number,
      call?.customer_number,
      event?.from_number,
      event?.from,
      event?.caller_number
    ].filter(Boolean);

    // Fallback: send to YOUR phone for debug if Retell didn’t include From
    const to = possible[0] || process.env.DEBUG_TO_NUMBER;

    if (!to) {
      console.log("NO_TO_NUMBER_FOUND");
      return res.status(200).json({ ok: true, ignored: "no_to_number" });
    }

    const client = twilio(accountSid, authToken);

    await client.messages.create({
      from: fromSms,
      to,
      body: "DEBUG: Retell webhook received. Reply 1/2/3 flow is active."
    });

    console.log("SENT_SMS_TO", to);
    return res.status(200).json({ ok: true, sms_sent: true, to });
  } catch (err) {
    console.log("TWILIO_SEND_ERROR", String(err));
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
