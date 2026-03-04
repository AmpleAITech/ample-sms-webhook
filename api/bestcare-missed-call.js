// api/bestcare-missed-call.js
// Twilio Voice "Call status changes" webhook.
// Sends missed-call menu SMS ONLY for true missed call statuses:
// no-answer, busy, failed, canceled
// Includes "Reply STOP to opt out." ONLY on this menu message.

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
    const noticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    const menuText =
      `Sorry we missed you.\n\n` +
      `Reply:\n` +
      `1 = Book new patient exam\n` +
      `2 = Reschedule / change appointment (${noticeHours}h notice)\n` +
      `3 = Other\n\n` +
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
