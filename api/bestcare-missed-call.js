// api/bestcare-missed-call.js
// Triggered by Twilio Voice "Call status changes" webhook.
// If call was not answered, send the missed-call SMS menu to the caller.
// Also optionally log a "missed call auto-text sent" row to Google Sheet.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const {
      CallStatus = "",
      From = "",
      CallSid = "",
    } = req.body || {};

    // Only act on missed-type statuses
    const missedStatuses = new Set(["no-answer", "busy", "failed", "canceled"]);
    if (!missedStatuses.has(String(CallStatus).toLowerCase())) {
      return res.status(200).send("ignored");
    }

    if (!From) {
      return res.status(200).send("missing From");
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromNumber = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromNumber) {
      return res.status(500).send("Missing Twilio env vars");
    }

    const client = twilio(accountSid, authToken);

    const menuText =
      "Sorry we missed you at Best Care Medical Centre.\n" +
      "Please reply with 1, 2, or 3 only:\n" +
      "1 = Book a telephone appointment\n" +
      "2 = Change an existing appointment\n" +
      "3 = Other";

    // Send SMS menu
    await client.messages.create({
      from: fromNumber,
      to: From,
      body: menuText,
    });

    // Optional: log to sheet that a missed call occurred + menu SMS sent
    // This helps the demo look "complete" even before the patient replies.
    try {
      await fetch("https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "phone",
          scenario: "missed_call",
          first_name: "",
          last_name: "",
          phone: From,
          email: "",
          gender: "",
          reason_for_appointment: "Missed call — auto SMS menu sent",
          consent: "n/a",
          urgent_flag: "no",
          notes: `Twilio CallStatus=${CallStatus}`,
          call_sid: CallSid,
          recording_url: ""
        }),
      });
    } catch (_) {}

    return res.status(200).send("ok");
  } catch (err) {
    return res.status(200).send("ok"); // demo-safe: never fail Twilio callback
  }
}
