// api/cal-webhook.js
import twilio from "twilio";

function pick(obj, paths) {
  for (const p of paths) {
    const val = p.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return null;
}

function formatDateTime(isoString) {
  const d = new Date(isoString);
  const date = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { date, time };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    const token = req.query?.token || req.query?.t || null;

    if (!process.env.CAL_WEBHOOK_SECRET) {
      return res.status(500).json({ error: "Missing CAL_WEBHOOK_SECRET in env" });
    }
    if (!token || token !== process.env.CAL_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized webhook" });
    }

    const body = req.body || {};

    // Soft accept ping/test payloads (200 ignored)
    const trigger = String(pick(body, ["triggerEvent", "event", "type"]) || "").toLowerCase();
    const hasPayload = !!body.payload;
    const looksLikePing =
      !hasPayload || trigger.includes("ping") || trigger.includes("test") || trigger.includes("webhook");

    const fullName = pick(body, [
      "payload.attendees.0.name",
      "payload.booking.attendees.0.name",
      "payload.attendee.name",
      "payload.booker.name",
      "payload.booking.booker.name",
      "payload.responses.name",
      "payload.booking.responses.name",
      "payload.user.name",
    ]);

    const phone = pick(body, [
      "payload.responses.phone",
      "payload.responses.phoneNumber",
      "payload.responses.Phone",
      "payload.responses.Phone number",
      "payload.responses.phone_number",
      "payload.booking.responses.phone",
      "payload.booking.responses.phoneNumber",
      "payload.booking.responses.Phone",
      "payload.booking.responses.Phone number",
      "payload.booking.responses.phone_number",
      "payload.attendees.0.phoneNumber",
      "payload.attendee.phoneNumber",
      "payload.booking.attendees.0.phoneNumber",
      "payload.booker.phoneNumber",
      "payload.booking.booker.phoneNumber",
    ]);

    const startTime = pick(body, [
      "payload.startTime",
      "payload.booking.startTime",
      "payload.event.startTime",
      "payload.booking.event.startTime",
      "payload.booking.start",
      "payload.start",
    ]);

    if (!fullName || !phone || !startTime) {
      if (looksLikePing) {
        return res.status(200).json({
          ok: true,
          ignored: true,
          reason: "ping/test payload missing booking fields",
          found: { fullName: !!fullName, phone: !!phone, startTime: !!startTime },
        });
      }

      return res.status(400).json({
        error: "Missing required fields from Cal payload",
        found: { fullName: !!fullName, phone: !!phone, startTime: !!startTime },
        hint: "In Cal.com Event Type → Booking questions, make Phone number REQUIRED so it appears in webhook payload.",
      });
    }

    const { date, time } = formatDateTime(startTime);

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const clinicPhone = process.env.CLINIC_PHONE || "855-393-0900";

    const smsBody =
      `Hello, We look forward to seeing ${fullName} on ${date}, at ${time}.\n` +
      `Please confirm your presence by replying YES or NO.\n\n` +
      `${clinicName},\n` +
      `T - ${clinicPhone}`;

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return res.status(500).json({
        error: "Missing Twilio env vars",
        missing: {
          TWILIO_ACCOUNT_SID: !TWILIO_ACCOUNT_SID,
          TWILIO_AUTH_TOKEN: !TWILIO_AUTH_TOKEN,
          TWILIO_FROM_NUMBER: !TWILIO_FROM_NUMBER,
        },
      });
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    const msg = await client.messages.create({
      to: String(phone).trim(),
      from: TWILIO_FROM_NUMBER,
      body: smsBody,
    });

    return res.status(200).json({ ok: true, sent: true, sid: msg.sid });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: err?.message || String(err) });
  }
}
