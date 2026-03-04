// api/bestcare-sms.js
// Twilio inbound SMS webhook (POST, x-www-form-urlencoded)
// Stateless + robust (no DB needed) by requiring prefix codes:
//
// 1A / 1B = book new patient exam (60 min) at Location A/B
// 2A / 2B = reschedule at Location A/B (48h notice policy)
// 3A / 3B = other at Location A/B
//
// Accepts formats like:
// "1A"
// "1A - John Smith, next Tue after 3"
// "2B: Sarah Khan, current appt Thu 2pm, want Fri morning"
// If they send only "1A" etc, we prompt for details.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};
    const from = String(body.From || "").trim();
    const msgRaw = String(body.Body || "").trim();

    if (!from) return twiml(res, "Sorry — missing phone number. Please try again.");

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Care";
    const bookingLink = process.env.CAL_BOOKING_LINK || ""; // optional: include a Cal.com link in replies
    const rescheduleNoticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    if (!msgRaw) return twiml(res, menuText(clinicName));

    const parsed = parseChoice(msgRaw);

    // If they didn't send a valid code, show menu again (simple + robust)
    if (!parsed) {
      return twiml(res, menuText(clinicName));
    }

    const { actionDigit, locationLetter, details } = parsed;

    // If they only sent the code with no details, ask for details (still stateless)
    if (!details) {
      return twiml(
        res,
        detailsPrompt({
          clinicName,
          actionDigit,
          locationLetter,
          bookingLink,
          rescheduleNoticeHours,
        })
      );
    }

    // They included details. We acknowledge and give the next step.
    return twiml(
      res,
      confirmText({
        clinicName,
        actionDigit,
        locationLetter,
        bookingLink,
        rescheduleNoticeHours,
      })
    );
  } catch (err) {
    return twiml(res, "Thanks — we received your message. If this is an emergency, please call 911.");
  }
}

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

function detailsPrompt({ clinicName, actionDigit, locationLetter, bookingLink, rescheduleNoticeHours }) {
  const loc = locationLabel(locationLetter);

  if (actionDigit === "1") {
    const linkLine = bookingLink ? `\nOr book directly here: ${bookingLink}` : "";
    return (
      `Got it — ${clinicName} (${loc}).\n` +
      `Please reply with: Full name + preferred day/time.\n` +
      `Example: "1${locationLetter} - John Smith, next Tuesday after 3pm".` +
      linkLine
    );
  }

  if (actionDigit === "2") {
    return (
      `Sure — ${clinicName} (${loc}).\n` +
      `Reminder: we ask for ${rescheduleNoticeHours} hours notice for reschedules.\n` +
      `Please reply with: Full name + current appointment day/time + preferred new day/time.\n` +
      `Example: "2${locationLetter} - Sarah Khan, current Thu 2pm, want Fri morning".`
    );
  }

  return (
    `No problem — ${clinicName} (${loc}).\n` +
    `Please reply with: Full name + how we can help.\n` +
    `Example: "3${locationLetter} - John Smith, question about insurance".`
  );
}

function confirmText({ clinicName, actionDigit, locationLetter, bookingLink, rescheduleNoticeHours }) {
  const loc = locationLabel(locationLetter);

  if (actionDigit === "1") {
    const linkLine = bookingLink ? `\nIf you want, you can also book here: ${bookingLink}` : "";
    return (
      `Thanks — got it. ${clinicName} (${loc}) will confirm shortly by text or call.\n` +
      `If this is urgent dental pain or swelling, please call us back right away.` +
      linkLine
    );
  }

  if (actionDigit === "2") {
    return (
      `Thanks — got it. ${clinicName} (${loc}) will confirm shortly.\n` +
      `Reminder: we ask for ${rescheduleNoticeHours} hours notice for reschedules.\n` +
      `If you are within ${rescheduleNoticeHours} hours, the team will let you know what is possible.`
    );
  }

  return `Thanks — got it. ${clinicName} (${loc}) will follow up shortly.`;
}

// Parse "1A", "1A - details", "1 A: details", etc.
function parseChoice(msg) {
  const s = String(msg || "").trim();

  // Normalize spaces: allow "1 A - ..." and "1A - ..."
  const compact = s.replace(/\s+/g, "");

  // Must begin with digit 1/2/3 then A/B
  const actionDigit = compact[0];
  const locationLetter = compact[1]?.toUpperCase();

  if (!["1", "2", "3"].includes(actionDigit)) return null;
  if (!["A", "B"].includes(locationLetter)) return null;

  // Remove the prefix from the ORIGINAL string in a forgiving way
  // Accept separators like "-", ":", etc.
  const prefixRegex = new RegExp(`^\\s*${actionDigit}\\s*${locationLetter}\\s*([\\-:])?\\s*`, "i");
  const details = s.replace(prefixRegex, "").trim();

  return { actionDigit, locationLetter, details: details || "" };
}

function locationLabel(letter) {
  // Keep it generic unless you have exact addresses in your KB
  return letter === "A" ? "Location A" : "Location B";
}

// Twilio expects TwiML XML response
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
