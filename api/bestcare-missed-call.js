// api/bestcare-missed-call.js
// Twilio Voice "Call status changes" webhook.
// Sends missed-call menu SMS ONLY for true missed call statuses:
// no-answer, busy, failed, canceled
// MENU: New Patient only.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};
    const callStatus = String(body.CallStatus || "").toLowerCase();
    const toNumber = String(body.From || "").trim();

    const isTrueMissed = ["no-answer", "busy", "failed", "canceled"].includes(callStatus);
    if (!isTrueMissed) return res.status(200).send("ignored");
    if (!toNumber) return res.status(200).send("missing From");

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return res.status(500).send("Missing Twilio env vars");
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const clinicPhone = process.env.CLINIC_PHONE || "855-393-0900";

    const menuText =
      `Sorry we missed you.\n\n` +
      `Reply:\n` +
      `1 = Book a New Patient Exam\n\n` +
      `${clinicName},\n` +
      `T - ${clinicPhone}\n\n` +
      `Reply STOP to opt out.`;

    await client.messages.create({
      from: TWILIO_FROM_NUMBER,
      to: toNumber,
      body: menuText,
    });

    return res.status(200).send("ok");
  } catch (err) {
    return res.status(200).send("ok");
  }
}
