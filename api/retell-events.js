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
      durationSeconds <= 15;

    if (!isQuickHangup) {
      return res.status(200).json({
        ok: true,
        ignored: "not_quick_hangup",
        disconnectionReason,
        durationSeconds,
      });
    }

    if (!from) return res.status(200).json({ ok: true, ignored: "missing_from_number" });
    if (!callId) return res.status(200).json({ ok: true, ignored: "missing_call_id" });

    // -------- DEDUPE (GET) - FAIL OPEN --------
    const dedupeBase = process.env.BESTCARE_DEDUPE_WEBHOOK_URL;
    if (!dedupeBase) {
      return res.status(500).json({ ok: false, error: "Missing BESTCARE_DEDUPE_WEBHOOK_URL" });
    }

    const dedupeUrl = `${dedupeBase}?action=dedupe_menu&call_id=${encodeURIComponent(callId)}`;

    // Fail-open so demo never breaks
    let dedupeAllow = true;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500);

      const dedupeResp = await fetch(dedupeUrl, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const raw = await dedupeResp.text();

      // If it returns JSON, respect allow/duplicate
      try {
        const parsed = JSON.parse(raw);
        dedupeAllow = !!parsed.allow;

        if (!dedupeAllow) {
          return res.status(200).json({
            ok: true,
            ignored: "deduped",
            reason: parsed.reason || "duplicate",
          });
        }
      } catch (_) {
        // Not JSON -> fail open
        dedupeAllow = true;
      }
    } catch (_) {
      dedupeAllow = true; // fail open
    }

    // -------- SEND MENU SMS --------
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

    return res.status(200).json({
      ok: true,
      sms_sent: true,
      to: from,
      callId,
      durationSeconds,
      dedupeAllow,
    });
  } catch (err) {
    // demo-safe: never cause webhook retries
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
