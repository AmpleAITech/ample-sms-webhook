// api/retell-events.js
// PURPOSE: Retell webhook -> send missed-call SMS menu via Twilio
// CURRENT: Debug-friendly version that logs the full Retell call object so we can
// reliably extract the caller phone number (no guessing).
//
// After you paste this, do ONE real call (call 236... hang up) then copy the
// "RETELL_CALL {...}" line from Vercel logs and send it to me.
// Then we'll lock the correct `from` field and remove any debug fallback.

import twilio from "twilio";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  try {
    const event = req.body || {};
    const eventType = String(event.event || event.type || "").toLowerCase();

    // Only process call end events to avoid multiple SMS sends
    if (eventType !== "call_ended") {
      return res.status(200).json({ ok: true, ignored: eventType });
    }

    const call = event.call || event.data || event.payload || event;

    // ✅ Key debug line: prints the whole call object
    console.log("RETELL_CALL", JSON.stringify(event.call || call));

    // Best-effort caller extraction (will be corrected once we see RETELL_CALL)
    const from =
      call?.from_number ||
      call?.from ||
      call?.caller_number ||
      call?.caller ||
      call?.phone_number ||
      call?.customer_number ||
      event?.from_number ||
      event?.from ||
      event?.caller_number ||
      "";

    // Optional duration (may be missing depending on Retell event)
    const duration = Number(
      call?.duration_seconds ??
      call?.duration ??
      call?.call_duration ??
      event?.duration_seconds ??
      0
    );

    // IMPORTANT: For now, don't rely on duration until we confirm the right field.
    // We'll re-enable duration <= 6 after we know Retell's duration key.

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const fromSms = process.env.TWILIO_FROM_NUMBER; // MUST be +14313405041

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

    // ✅ For debugging only:
    // If caller number is missing, send to DEBUG_TO_NUMBER so you can verify the webhook fired.
    // DO NOT use this for production/demo once we confirm the real caller field.
    const debugTo = process.env.DEBUG_TO_NUMBER || "";
    const to = from || debugTo;

    if (!to) {
      return res.status(200).json({ ok: true, ignored: "no_to_number_found" });
    }

    await client.messages.create({
      from: fromSms,
      to,
      body: `${menuText}\n\n(debug: duration=${duration}s event=${eventType})`
    });

    return res.status(200).json({
      ok: true,
      sms_sent: true,
      to_source: to === from ? "caller" : "debug",
      duration
    });
  } catch (err) {
    return res.status(200).json({ ok: true, error: String(err) });
  }
}
