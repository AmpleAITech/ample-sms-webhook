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
    const quickHangup = CallStatus === "completed" && CallDuration > 0 && CallDuration <= 6;

    if (!realMissed && !quickHangup) return res.status(200).send("ignored");
    if (!From) return res.status(200).send("missing From");

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return res.status(500).send("Missing Twilio env vars");
    }

    // Optional dedupe (fail-open)
    // If you have a dedupe endpoint, set DEDUPE_WEBHOOK_URL to something that returns JSON: { allow: true/false }
    // Example call: `${DEDUPE_WEBHOOK_URL}?action=dedupe_menu&call_id=<CallSid>`
    const dedupeBase = process.env.DEDUPE_WEBHOOK_URL || "";
    if (dedupeBase) {
      const dedupeUrl = `${dedupeBase}?action=dedupe_menu&call_id=${encodeURIComponent(CallSid)}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);
        const dedupeResp = await fetch(dedupeUrl, { method: "GET", signal: controller.signal });
        clearTimeout(timeout);

        const raw = await dedupeResp.text();
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.allow === false) return res.status(200).send("deduped");
        } catch (_) {
          // fail open
        }
      } catch (_) {
        // fail open
      }
    }

    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Care";

    const menuText =
      `Sorry we missed you at ${clinicName}.\n` +
      `Reply with ONE of these (example: 1A):\n` +
      `1A = Book New Patient Exam (Location A)\n` +
      `1B = Book New Patient Exam (Location B)\n` +
      `2A = Reschedule (48h notice) - Location A\n` +
      `2B = Reschedule (48h notice) - Location B\n` +
      `3A = Other - Location A\n` +
      `3B = Other - Location B`;

    await client.messages.create({
      from: TWILIO_FROM_NUMBER,
      to: From,
      body: menuText,
    });

    return res.status(200).send("ok");
  } catch (err) {
    // Demo-safe: do not cause Twilio retries
    return res.status(200).send("ok");
  }
}
