import twilio from "twilio";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    const {
      secret,
      patientName,
      patientPhone,
      appointmentDateTime, // ISO string
      clinicPhone, // optional
    } = req.body || {};

    // Auth
    if (!secret || secret !== process.env.SMS_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate
    if (!patientName || !patientPhone || !appointmentDateTime) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const clinicPhoneFinal = clinicPhone || process.env.CLINIC_PHONE || process.env.TWILIO_FROM_NUMBER;
    const clinicName = process.env.CLINIC_NAME || "Huron Dental Care";

    // Format date/time
    const dt = new Date(appointmentDateTime);
    if (isNaN(dt.getTime())) {
      return res.status(400).json({ error: "Invalid appointmentDateTime" });
    }

    const dateStr = dt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    const body =
      `Hello, We look forward to seeing ${patientName} on ${dateStr} at ${timeStr}. ` +
      `Please confirm your presence by replying YES or NO.\n` +
      `Thank you.\n` +
      `${clinicName}\n` +
      `T - ${clinicPhoneFinal}`;

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const msg = await client.messages.create({
      from: fromNumber,
      to: patientPhone,
      body,
    });

    return res.status(200).json({ ok: true, sid: msg.sid });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
