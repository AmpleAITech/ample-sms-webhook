import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const call = event.call || event.data || event.payload || event;

    // Only handle ended calls
    const callStatus = String(call?.call_status || "").toLowerCase();
    if (callStatus !== "ended") {
      return res.status(200).json({ ok: true, ignored: "not_ended", callStatus });
    }

    const callId = String(call?.call_id || "").trim();
    const from = String(call?.from_number || "").trim();
    const disconnectionReason = String(call?.disconnection_reason || "").toLowerCase();

    const durationSeconds = Number(
      call?.call_cost?.total_duration_seconds ??
        (call?.duration_ms ? Math.round(Number(call.duration_ms) / 1000) : 0)
    );

    // Simulated missed call: quick user hangup
    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 6;

    if (!isQuickHangup) {
      return res.status(200).json({
        ok: true,
        ignored: "not_quick_hangup",
        disconnectionReason,
        durationSeconds,
      });
    }

    if (!callId) return res.status(200).json({ ok: true, ignored: "missing_call_id" });
    if (!from) return res.status(200).json({ ok: true, ignored: "missing_from_number" });

    // ✅ DEDUPE (GET) - prevents double menu SMS across parallel serverless instances
    const dedupeBase = process.env.BESTCARE_DEDUPE_WEBHOOK_URL;
    if (!dedupeBase) {
      return res.status(500).json({ ok: false, error: "Missing BESTCARE_DEDUPE_WEBHOOK_URL" });
    }

    const dedupeUrl = `${dedupeBase}?action=dedupe_menu&call_id=${encodeURIComponent(callId)}`;
    const dedupeResp = await fetch(dedupeUrl, { method: "GET" });
    const dedupeJson = await dedupeResp.json().catch(() => ({}));

    if (!dedupeJson.allow) {
      return res.status(200).json({ ok: true, ignored: "deduped", reason: dedupeJson.reason || "duplicate" });
    }

    // Send menu SMS via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER; // +14313405041

    if (!accountSid || !authToken || !fromSms) {
      return res.status(500).json({ ok: false, error: "Missing Twilio env vars" });
    }

    const client = twilio(accountSid, authToken);

    const menuText =
      "Sorry we missed you at Best Care Medical Centre.\n" +
      "Please reply with 1, 2, or 3 only:\n" +
      "1 = Book a telephone appointment\n" +
      "2 = Change an existing appointment\n" +
      "3 = Other";

    await client.messages.create({
      from: fromSms,
      to: from,
      body: menuText,
    });

    // Optional: log menu-sent to your Google Sheet
    try {
      await fetch("https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "phone",
          scenario: "missed_call",
          phone: from,
          reason_for_appointment: "Simulated missed call (quick hangup) — auto SMS menu sent",
          consent: "n/a",
          urgent_flag: "no",
          notes: `call_id=${callId} duration=${durationSeconds}s`,
          call_sid: call?.telephony_identifier?.twilio_call_sid || "",
          recording_url: call?.recording_url || "",
        }),
      });
    } catch (_) {}

    return res.status(200).json({ ok: true, sms_sent: true, to: from, callId, durationSeconds });
  } catch (err) {
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
