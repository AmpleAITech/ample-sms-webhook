import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const event = req.body || {};
  const call = event.call || event.data || event.payload || event;

  // Try to find caller number
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

  // Try to find duration
  const duration =
    Number(call?.duration_seconds ?? call?.duration ?? call?.call_duration ?? event?.duration_seconds ?? 0);

  const eventType = String(event.event || event.type || "").toLowerCase();

  console.log("RETELL_EVENT_TYPE", eventType);
  console.log("RETELL_FROM", from);
  console.log("RETELL_DURATION", duration);
  console.log("RETELL_KEYS", Object.keys(event));

  // Twilio env
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromSms = process.env.TWILIO_FROM_NUMBER;
  const debugTo = process.env.DEBUG_TO_NUMBER;

  if (!accountSid || !authToken || !fromSms) {
    return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
  }

  // For now, still send a debug SMS so you see it live
  const to = from || debugTo;
  if (!to) return res.status(200).json({ ok: true, ignored: "no_to" });

  const client = twilio(accountSid, authToken);
  await client.messages.create({
    from: fromSms,
    to,
    body: `DEBUG parsed: duration=${duration}s. If duration<=6, we will send menu next.`
  });

  return res.status(200).json({ ok: true });
}
