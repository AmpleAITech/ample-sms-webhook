// api/retell-events.js
// Retell webhook helper: sends missed-call menu SMS ONLY on quick hangups (<= 15s).
// Includes "Reply STOP to opt out." ONLY on this menu message.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, hint: "POST only" });

  try {
    const event = req.body || {};
    const call = event.call || event.data || event.payload || event;

    const callStatus = String(call?.call_status || "").toLowerCase();
    if (callStatus !== "ended") {
      return res.status(200).json({ ok: true, ignored: "not_ended", callStatus });
    }

    const callId = String(call?.call_id || "").trim();
    const fromNumber = String(call?.from_number || "").trim();
    const disconnectionReason = String(call?.disconnection_reason || "").toLowerCase();

    const durationSeconds = Number(
      call?.call_cost?.total_duration_seconds ??
        (call?.duration_ms ? Math.round(Number(call.duration_ms) / 1000) : 0)
    );

    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 15;

    if (!isQuickHangup) {
      return res.status(200).json({ ok: true, done: true, isQuickHangup: false });
    }

    if (!fromNumber) return res.status(200).json({ ok: true, ignored: "missing_from_number" });
    if (!callId) return res.status(200).json({ ok: true, ignored: "missing_call_id" });

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromSms) {
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
    }

    const client = twilio(accountSid, authToken);

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

    await client.messages.create({ from: fromSms, to: fromNumber, body: menuText });

    return res.status(200).json({ ok: true, sms_sent: true, isQuickHangup: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
