// api/bestcare-missed-call.js
// Twilio Voice "Call status changes" webhook
// Sends missed-call SMS if:
// - status is no-answer/busy/failed/canceled
// OR
// - call completed quickly (CallDuration <= 6 seconds) => "simulated missed call"

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};

    const CallStatus = String(body.CallStatus || "").toLowerCase();
    const From = String(body.From || "").trim();
    const CallSid = String(body.CallSid || "").trim();
    const CallDuration = Number(body.CallDuration || 0); // only present on completed

    // Determine "missed" (real missed OR quick hangup)
    const realMissed = ["no-answer", "busy", "failed", "canceled"].includes(CallStatus);
    const quickHangup = (CallStatus === "completed" && CallDuration > 0 && CallDuration <= 6);

    if (!realMissed && !quickHangup) {
      return res.status(200).send("ignored");
    }
    if (!From) return res.status(200).send("missing From");

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
      body: menuText
    });

    // Optional: log the missed call + auto text sent (nice for demo)
    try {
      await fetch("https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "phone",
          scenario: "missed_call",
          phone: From,
          reason_for_appointment: quickHangup
            ? "Missed call (simulated quick hangup) — auto SMS menu sent"
            : "Missed call — auto SMS menu sent",
          consent: "n/a",
          urgent_flag: "no",
          notes: `CallStatus=${CallStatus} CallDuration=${CallDuration}`,
          call_sid: CallSid
        })
      });
    } catch (_) {}

    return res.status(200).send("ok");
  } catch (err) {
    // Demo-safe: do not cause Twilio retries
    return res.status(200).send("ok");
  }
}
