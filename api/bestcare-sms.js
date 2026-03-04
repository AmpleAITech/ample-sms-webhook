// api/bestcare-sms.js
// Purpose: Twilio inbound SMS webhook (POST, x-www-form-urlencoded).
// Handles:
// - YES/NO confirmation replies (replaces Studio)
// - Missed-call menu replies (1/2/3)
// - Follow-up prompts for details
//
// Stateless for maximum demo reliability.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};
    const from = String(body.From || "").trim();
    const msgRaw = String(body.Body || "").trim();

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const clinicPhone = process.env.CLINIC_PHONE || process.env.TWILIO_FROM_NUMBER || "";
    const bookingLink = process.env.CAL_BOOKING_LINK || "";
    const noticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    if (!from) return twiml(res, "Sorry — missing phone number. Please try again.");
    if (!msgRaw) return twiml(res, menuText(clinicName, noticeHours));

    // -----------------------------
    // (A) YES / NO confirmations
    // -----------------------------
    const yn = normalizeYesNo(msgRaw);
    if (yn === "YES") {
      return twiml(
        res,
        `Thank you for confirming your presence. We look forward to seeing you.\n${clinicName}\nT - ${clinicPhone}`
      );
    }
    if (yn === "NO") {
      return twiml(
        res,
        `No problem — we’ve noted you can’t make it. Please reply here or call T - ${clinicPhone} to reschedule.\n${clinicName}`
      );
    }

    // -----------------------------
    // (B) Menu replies 1 / 2 / 3
    // Allow formats like:
    // "1"
    // "1 - John Smith, Tue after 3"
    // "2: Sarah Khan, Thu 2pm -> Fri morning"
    // -----------------------------
    const parsed = parseMenuReply(msgRaw);
    if (!parsed) {
      // invalid -> show menu + hint
      return twiml(
        res,
        `Your answer could not be interpreted.\n\n${menuText(clinicName, noticeHours)}`
      );
    }

    const { choice, details } = parsed;

    // If no details, prompt for details based on choice
    if (!details) {
      if (choice === "1") {
        const linkLine = bookingLink ? `\nOr book here: ${bookingLink}` : "";
        return twiml(
          res,
          `Got it — ${clinicName} (Mississauga).\nPlease reply with: Full name + preferred day/time.\nExample: "Sarah Khan, next Tue after 3pm".\nYou can also call T - ${clinicPhone}.` +
            linkLine
        );
      }

      if (choice === "2") {
        return twiml(
          res,
          `Sure — ${clinicName} (Mississauga).\nReminder: we ask for ${noticeHours} hours notice for reschedules.\nPlease reply with: Full name + current appt day/time + preferred new time.\nExample: "Sarah Khan, current Thu 2pm, want Fri morning".\nYou can also call T - ${clinicPhone}.`
        );
      }

      return twiml(
        res,
        `No problem — ${clinicName} (Mississauga).\nPlease reply with: Full name + how we can help.\nExample: "Sarah Khan, question about insurance".\nYou can also call T - ${clinicPhone}.`
      );
    }

    // They included details in the same message -> acknowledge
    if (choice === "1") {
      const linkLine = bookingLink ? `\nOptional booking link: ${bookingLink}` : "";
      return twiml(
        res,
        `Thanks — got it. ${clinicName} (Mississauga) will confirm shortly by text or call.` + linkLine
      );
    }

    if (choice === "2") {
      return twiml(
        res,
        `Thanks — got it. ${clinicName} (Mississauga) will confirm shortly.\nReminder: we ask for ${noticeHours} hours notice for reschedules.`
      );
    }

    return twiml(res, `Thanks — got it. ${clinicName} (Mississauga) will follow up shortly.`);
  } catch (_) {
    return twiml(res, "Thanks — we received your message. If this is an emergency, please call 911.");
  }
}

// ---------- Menu copy ----------

function menuText(clinicName, noticeHours) {
  return (
    `Sorry we missed you at ${clinicName}.\n` +
    `Reply:\n` +
    `1 = Book new patient exam\n` +
    `2 = Reschedule / change appointment (${noticeHours}h notice)\n` +
    `3 = Other`
  );
}

// Parse menu reply: returns { choice: "1"|"2"|"3", details: string }
function parseMenuReply(msg) {
  const s = String(msg || "").trim();

  // allow leading "1", "2", "3"
  const firstChar = s[0];
  if (!["1", "2", "3"].includes(firstChar)) return null;

  // strip prefix: "1", "1-", "1:" etc
  const prefixRegex = new RegExp(`^\\s*${firstChar}\\s*([\\-:])?\\s*`, "i");
  const details = s.replace(prefixRegex, "").trim();

  return { choice: firstChar, details: details || "" };
}

function normalizeYesNo(msg) {
  const s = String(msg || "").trim().toLowerCase();
  if (s === "yes" || s === "y") return "YES";
  if (s === "no" || s === "n") return "NO";
  return "";
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
