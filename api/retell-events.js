// api/retell-events.js
import twilio from "twilio";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const call = event.call || event.data || event.payload || event;

    // Only act on ended calls
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

    // Quick hangup detection (<= 15s)
    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 15;

    if (!isQuickHangup) {
      return res.status(200).json({ ok: true, done: true });
    }

    if (!callId || !fromNumber) {
      return res.status(200).json({ ok: true, ignored: "missing_call_id_or_number" });
    }

    // -------- DEDUPE (2 minutes) --------
    // Retell can deliver duplicate ended events. This makes sending idempotent.
    const key = `retell:menu:${callId}`;
    const already = await redis.get(key);
    if (already) return res.status(200).json({ ok: true, ignored: "deduped" });
    await redis.set(key, "1", { ex: 120 });
    // -----------------------------------

    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
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
      to: fromNumber,
      body: menuText,
    });

    return res.status(200).json({ ok: true, sms_sent: true });
  } catch (err) {
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
