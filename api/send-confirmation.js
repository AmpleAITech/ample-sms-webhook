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

    // 1) Auth
    if (!secret || secret !== process.env.SMS_WEBHOOK_SECRET) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // 2) Validate
    if (!patientName || !patientPhone || !appointmentDateTime) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const fromNumber = process.env.TWILIO_FROM_NUMBER;
    const clinicPhoneFinal = clinicPhone || process.env.CLINIC_PHONE;

    // 3) Format date/time (simple demo-safe formatting)
    const dt = new Date(appointmentDateTime);
    if (isNaN(dt.getTime())) {
      return res.status(400).json({ error: "Invalid appointmentDateTime" });
    }

    // Format: "February 26, 2025 at 8:45 AM"
    const dateStr = dt.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    const timeStr = dt.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });

    // 4) Message (your required format)
    const body =
      `Hello, We look forward to seeing ${patientName} on ${dateStr} at ${timeStr}. ` +
      `Please confirm your presence by replying YES or NO.\n` +
      `Thank you.\n` +
      `Ample AI Demo Clinic\n` +
      `T - ${clinicPhoneFinal}`;

    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

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
