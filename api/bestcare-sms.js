// api/bestcare-sms.js
// Twilio inbound SMS webhook (POST, x-www-form-urlencoded)
//
// Supports BOTH:
// 1) YES/NO booking confirmations (replaces Studio flow)
// 2) Missed-call menu flows: 1A/1B/2A/2B/3A/3B (stateless, no DB)
//
// Notes:
// - If you want to keep times/booking link: set CAL_BOOKING_LINK in Vercel env.
// - Uses CLINIC_PHONE for the "call T -" line (fallbacks to TWILIO_FROM_NUMBER).

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};
    const from = String(body.From || "").trim();
    const msgRaw = String(body.Body || "").trim();

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Care";
    const clinicPhone = process.env.CLINIC_PHONE || process.env.TWILIO_FROM_NUMBER || "";
    const bookingLink = process.env.CAL_BOOKING_LINK || "";
    const rescheduleNoticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    if (!from) return twiml(res, "Sorry — missing phone number. Please try again.");
    if (!msgRaw) return twiml(res, menuText(clinicName));

    // -----------------------------
    // (A) YES/NO CONFIRMATION HANDLING (replaces Studio)
    // -----------------------------
    const yn = normalizeYesNo(msgRaw);
    if (yn === "YES") {
      return twiml(
        res,
        `Thank you for confirming your presence. We look forward to seeing you.\n` +
          `${clinicName}\n` +
          `T - ${clinicPhone}`
      );
    }
    if (yn === "NO") {
      return twiml(
        res,
        `No problem — we’ve noted you can’t make it. Please reply here or call T - ${clinicPhone} to reschedule.\n` +
          `${clinicName}`
      );
    }

    // -----------------------------
    // (B) MENU FLOW HANDLING: 1A/1B/2A/2B/3A/3B
    // -----------------------------
    const parsed = parseChoice(msgRaw);

    // If they didn't send a valid menu code, respond like Studio "invalid"
    // (but also show menu so they can proceed)
    if (!parsed) {
      return twiml(
        res,
        `Your answer could not be interpreted. Please reply with:\n` +
          `- YES or NO (for confirmations), OR\n` +
          `- One of these (example: 1A):\n` +
          menuText(clinicName)
      );
    }

    const { actionDigit, locationLetter, details } = parsed;

    // If they sent only code, ask for details
    if (!details) {
      return twiml(
        res,
        detailsPrompt({
          clinicName,
          clinicPhone,
          actionDigit,
          locationLetter,
          bookingLink,
          rescheduleNoticeHours,
        })
      );
    }

    // They included details — acknowledge and say the team will confirm
    return twiml(
      res,
      confirmText({
        clinicName,
        clinicPhone,
        actionDigit,
        locationLetter,
        bookingLink,
        rescheduleNoticeHours,
      })
    );
  } catch (_) {
    return twiml(res, "Thanks — we received your message. If this is an emergency, please call 911.");
  }
}

// ---------- Copy blocks ----------

function menuText(clinicName) {
  return (
    `Sorry we missed you at ${clinicName}.\n` +
    `Reply with ONE of these (example: 1A):\n` +
    `1A = Book New Patient Exam (Location A)\n` +
    `1B = Book New Patient Exam (Location B)\n` +
    `2A = Reschedule (48h notice) - Location A\n` +
    `2B = Reschedule (48h notice) - Location B\n` +
    `3A = Other - Location A\n` +
    `3B = Other - Location B`
  );
}

function detailsPrompt({ clinicName, clinicPhone, actionDigit, locationLetter, bookingLink, rescheduleNoticeHours }) {
  const loc = locationLabel(locationLetter);

  if (actionDigit === "1") {
    const linkLine = bookingLink ? `\nOr book directly here: ${bookingLink}` : "";
    return (
      `Got it — ${clinicName} (${loc}).\n` +
      `Please reply with: Full name + preferred day/time.\n` +
      `Example: "1${locationLetter} - John Smith, next Tuesday after 3pm".\n` +
      `If you prefer, you can also call T - ${clinicPhone}.` +
      linkLine
    );
  }

  if (actionDigit === "2") {
    return (
      `Sure — ${clinicName} (${loc}).\n` +
      `Reminder: we ask for ${rescheduleNoticeHours} hours notice for reschedules.\n` +
      `Please reply with: Full name + current appointment day/time + preferred new day/time.\n` +
      `Example: "2${locationLetter} - Sarah Khan, current Thu 2pm, want Fri morning".\n` +
      `You can also call T - ${clinicPhone}.`
    );
  }

  return (
    `No problem — ${clinicName} (${loc}).\n` +
    `Please reply with: Full name + how we can help.\n` +
    `Example: "3${locationLetter} - John Smith, question about insurance".\n` +
    `You can also call T - ${clinicPhone}.`
  );
}

function confirmText({ clinicName, clinicPhone, actionDigit, locationLetter, bookingLink, rescheduleNoticeHours }) {
  const loc = locationLabel(locationLetter);

  if (actionDigit === "1") {
    const linkLine = bookingLink ? `\nOptional booking link: ${bookingLink}` : "";
    return (
      `Thanks — got it. ${clinicName} (${loc}) will confirm shortly by text or call.\n` +
      `If you have urgent dental pain or swelling, please call T - ${clinicPhone} right away.` +
      linkLine
    );
  }

  if (actionDigit === "2") {
    return (
      `Thanks — got it. ${clinicName} (${loc}) will confirm shortly.\n` +
      `Reminder: we ask for ${rescheduleNoticeHours} hours notice for reschedules.\n` +
      `If you are within ${rescheduleNoticeHours} hours, the team will let you know what is possible.\n` +
      `If you prefer, call T - ${clinicPhone}.`
    );
  }

  return (
    `Thanks — got it. ${clinicName} (${loc}) will follow up shortly.\n` +
    `If you prefer, call T - ${clinicPhone}.`
  );
}

// ---------- Helpers ----------

function normalizeYesNo(msg) {
  const s = String(msg || "").trim().toLowerCase();
  if (s === "yes" || s === "y") return "YES";
  if (s === "no" || s === "n") return "NO";
  return "";
}

// Parse "1A", "1A - details", "1 A: details"
function parseChoice(msg) {
  const s = String(msg || "").trim();
  const compact = s.replace(/\s+/g, "");

  const actionDigit = compact[0];
  const locationLetter = (compact[1] || "").toUpperCase();

  if (!["1", "2", "3"].includes(actionDigit)) return null;
  if (!["A", "B"].includes(locationLetter)) return null;

  const prefixRegex = new RegExp(`^\\s*${actionDigit}\\s*${locationLetter}\\s*([\\-:])?\\s*`, "i");
  const details = s.replace(prefixRegex, "").trim();

  return { actionDigit, locationLetter, details: details || "" };
}

function locationLabel(letter) {
  return letter === "A" ? "Location A" : "Location B";
}

function twiml(res, message) {
  res.setHeader("Content-Type", "text/xml");
  return res.status(200).send(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`
  );
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
