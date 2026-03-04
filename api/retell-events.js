// api/retell-events.js
// Purpose: Retell webhook helper for deterministic demo behavior.
// If caller hangs up quickly (<= 15s), send missed-call SMS menu (1/2/3).
// Otherwise do nothing.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, hint: "POST only" });

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

    // Quick hangup = demo missed call trigger
    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 15;

    if (!isQuickHangup) {
      return res.status(200).json({ ok: true, done: true, isQuickHangup: false });
    }

    if (!fromNumber) return res.status(200).json({ ok: true, ignored: "missing_from_number" });
    if (!callId) return res.status(200).json({ ok: true, ignored: "missing_call_id" });

    // Optional dedupe (fail-open)
    const dedupeBase = process.env.DEDUPE_WEBHOOK_URL || "";
    if (dedupeBase) {
      const dedupeUrl = `${dedupeBase}?action=dedupe_menu&call_id=${encodeURIComponent(callId)}`;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1500);

        const dedupeResp = await fetch(dedupeUrl, { method: "GET", signal: controller.signal });
        clearTimeout(timeout);

        const raw = await dedupeResp.text();
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.allow === false) {
            return res.status(200).json({ ok: true, ignored: "deduped" });
          }
        } catch (_) {
          // non-JSON: fail open
        }
      } catch (_) {
        // fail open
      }
    }

    // Twilio env vars
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !fromSms) {
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
    }

    const client = twilio(accountSid, authToken);

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const noticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    // Short menu (matches inbound SMS handler expectations)
    const menuText =
      `Sorry we missed you at ${clinicName}.\n` +
      `Reply:\n` +
      `1 = Book new patient exam\n` +
      `2 = Reschedule / change appointment (${noticeHours}h notice)\n` +
      `3 = Other`;

    await client.messages.create({ from: fromSms, to: fromNumber, body: menuText });

    return res.status(200).json({ ok: true, sms_sent: true, isQuickHangup: true });
  } catch (err) {
    // Demo-safe: avoid webhook retry storms
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
