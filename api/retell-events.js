import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const call = event.call || event.data || event.payload || event;

    // ✅ Robust "ended" detection (works regardless of event.event naming)
    const callStatus = String(call?.call_status || "").toLowerCase();
    if (callStatus !== "ended") {
      return res.status(200).json({ ok: true, ignored: "not_ended", callStatus, eventType: event.event || event.type });
    }

    // ✅ Extract caller number (confirmed in your payload)
    const from = String(call?.from_number || "").trim();
    if (!from) {
      return res.status(200).json({ ok: true, ignored: "missing_from_number" });
    }

    // ✅ Duration: prefer total_duration_seconds; fallback to duration_ms
    const durationSeconds = Number(
      call?.call_cost?.total_duration_seconds ??
      (call?.duration_ms ? Math.round(Number(call.duration_ms) / 1000) : 0)
    );

    // ✅ Simulated missed call: quick hangup
    const disconnectionReason = String(call?.disconnection_reason || "").toLowerCase();
    const isQuickHangup =
      disconnectionReason === "user_hangup" &&
      durationSeconds > 0 &&
      durationSeconds <= 6;

    if (!isQuickHangup) {
      return res.status(200).json({
        ok: true,
        ignored: "not_quick_hangup",
        disconnectionReason,
        durationSeconds
      });
    }

    // Twilio env
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
      body: menuText
    });

    return res.status(200).json({ ok: true, sms_sent: true, from, durationSeconds });
  } catch (err) {
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
