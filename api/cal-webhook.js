import twilio from "twilio";

function pick(obj, paths) {
  for (const p of paths) {
    const val = p.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), obj);
    if (val !== undefined && val !== null && val !== "") return val;
  }
  return null;
}

function formatDateTime(isoString) {
  // Keep it simple for demo: Cal usually sends ISO. This formats into a readable local-ish string.
  // If you want strict timezone handling, we can add it later.
  const d = new Date(isoString);
  const date = d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return { date, time };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  try {
    // 1) Verify shared secret (simple header or body check)
    const secret =
      req.headers["x-cal-secret"] ||
      req.headers["x-webhook-secret"] ||
      pick(req.body, ["secret", "data.secret"]);

    if (!process.env.CAL_WEBHOOK_SECRET) {
      return res.status(500).json({ error: "Missing CAL_WEBHOOK_SECRET in env" });
    }
    if (secret !== process.env.CAL_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized webhook" });
    }

    // 2) Only react to booking created
    const trigger = pick(req.body, ["triggerEvent", "event", "type"]);
    // If Cal uses different naming, we still proceed—demo-friendly. (We can tighten later.)
    // You can uncomment this guard once you confirm payload fields:
    // if (trigger && !String(trigger).toLowerCase().includes("created")) return res.status(200).json({ ignored: true });

    // 3) Extract patient + booking details from Cal payload (tries multiple likely paths)
    const fullName = pick(req.body, [
      "payload.attendees.0.name",
      "payload.attendee.name",
      "payload.user.name",
      "payload.responses.name",
      "payload.booking.attendees.0.name",
      "payload.booking.responses.name",
    ]);

    const phone = pick(req.body, [
      "payload.attendees.0.phoneNumber",
      "payload.attendee.phoneNumber",
      "payload.responses.phone",
      "payload.responses.phoneNumber",
      "payload.booking.attendees.0.phoneNumber",
      "payload.booking.responses.phone",
      "payload.booking.responses.phoneNumber",
    ]);

    const startTime = pick(req.body, [
      "payload.startTime",
      "payload.booking.startTime",
      "payload.event.startTime",
      "payload.booking.event.startTime",
    ]);

    if (!phone || !startTime || !fullName) {
      return res.status(400).json({
        error: "Missing required fields",
        found: { fullName: !!fullName, phone: !!phone, startTime: !!startTime },
      });
    }

    const { date, time } = formatDateTime(startTime);

    // 4) Compose SMS exactly like your example (dynamic)
    const clinicPhone = process.env.CLINIC_PHONE || process.env.TWILIO_FROM_NUMBER;

    const body =
      `Hello, We look forward to seeing ${fullName} on ${date} at ${time}. ` +
      `Please confirm your presence by replying YES or NO.\n` +
      `Thank you.\n` +
      `Ample AI Demo Clinic\n` +
      `T - ${clinicPhone}`;

    // 5) Send via Twilio
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const msg = await client.messages.create({
      to: phone,
      from: process.env.TWILIO_FROM_NUMBER,
      body,
    });

    return res.status(200).json({ sent: true, sid: msg.sid });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: err?.message || String(err) });
  }
}
