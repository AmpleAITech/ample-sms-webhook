import twilio from "twilio";

// Demo-safe dedupe: if we text the same caller within 30s, skip.
// Note: serverless memory isn't perfect across cold starts, but it kills most duplicates live.
const recent = new Map(); // key: from_number, value: timestamp_ms

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const call = event.call || event.data || event.payload || event;

    const callStatus = String(call?.call_status || "").toLowerCase();
    if (callStatus !== "ended") {
      return res.status(200).json({
        ok: true,
        ignored: "not_ended",
        callStatus,
        eventType: event.event || event.type
      });
    }

    const from = String(call?.from_number || "").trim();
    if (!from) return res.status(200).json({ ok: true, ignored: "missing_from_number" });

    const durationSeconds = Number(
      call?.call_cost?.total_duration_seconds ??
      (call?.duration_ms ? Math.round(Number(call.duration_ms) / 1000) : 0)
    );

    const disconnectionReason = String(call?.disconnection_reason || "").toLowerCase();

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
        durationSeconds
      });
    }

    // ✅ Dedupe: skip if we already sent to this caller recently
    const now = Date.now();
    const last = recent.get(from) || 0;
    if (now - last < 30000) {
      return res.status(200).json({ ok: true, ignored: "dedup_30s" });
    }
    recent.set(from, now);

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
