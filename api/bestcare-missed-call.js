// api/bestcare-missed-call.js
// Purpose: Twilio Voice "Call status changes" webhook.
// Sends missed-call SMS menu ONLY for true missed call statuses:
// no-answer, busy, failed, canceled
//
// IMPORTANT: Do NOT treat "completed + short duration" as missed call here
// if Retell is handling quick-hangups. This prevents double SMS.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};

    const callStatus = String(body.CallStatus || "").toLowerCase();
    const from = String(body.From || "").trim();
    const callSid = String(body.CallSid || "").trim();

    const isTrueMissed = ["no-answer", "busy", "failed", "canceled"].includes(callStatus);

    if (!isTrueMissed) return res.status(200).send("ignored");
    if (!from) return res.status(200).send("missing From");

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return res.status(500).send("Missing Twilio env vars");
    }

    // Optional dedupe (fail-open)
    const dedupeBase = process.env.DEDUPE_WEBHOOK_URL || "";
    if (dedupeBase && callSid) {
      const dedupeUrl = `${dedupeBase}?action=dedupe_menu&call_id=${encodeURIComponent(callSid)}`;
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

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const noticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    const menuText =
      `Sorry we missed you at ${clinicName}.\n` +
      `Reply:\n` +
      `1 = Book new patient exam\n` +
      `2 = Reschedule / change appointment (${noticeHours}h notice)\n` +
      `3 = Other`;

    await client.messages.create({
      from: TWILIO_FROM_NUMBER,
      to: from,
      body: menuText,
    });

    return res.status(200).send("ok");
  } catch (err) {
    // Demo-safe: do not cause Twilio retries
    return res.status(200).send("ok");
  }
}
