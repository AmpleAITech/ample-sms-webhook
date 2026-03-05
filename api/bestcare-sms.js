// api/bestcare-sms.js
// Twilio inbound SMS webhook (POST, x-www-form-urlencoded).
// BULLETPROOF DEMO MODE:
// - Accepts only:
//    * YES/NO (confirmation replies)
//    * "1" (new patient exam request) optionally with details: "1 - John Smith, Fri morning"
// - Anything else => demo refusal message
// - Consistent footer

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};
    const from = String(body.From || "").trim();
    const msgRaw = String(body.Body || "").trim();

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const clinicPhone = process.env.CLINIC_PHONE || "855-393-0900";
    const bookingLink = process.env.CAL_BOOKING_LINK || ""; // optional

    if (!from) return twiml(res, `Sorry — missing phone number.\n\n${footer(clinicName, clinicPhone)}`);

    // Empty message -> send menu
    if (!msgRaw) return twiml(res, menuText(clinicName, clinicPhone));

    // YES/NO confirmations for booking confirmation SMS
    const yn = normalizeYesNo(msgRaw);
    if (yn === "YES") {
      return twiml(
        res,
        `Thanks for confirming.\nWe look forward to seeing you.\n\n${footer(clinicName, clinicPhone)}`
      );
    }
    if (yn === "NO") {
      return twiml(
        res,
        `No problem — we’ve noted you can’t make it.\nPlease call us to reschedule.\n\n${footer(
          clinicName,
          clinicPhone
        )}`
      );
    }

    // NEW PATIENT ONLY: must start with "1"
    const parsed = parseOneOnly(msgRaw);

    // If message is NOT "1..." => refuse
    if (!parsed) {
      return twiml(res, demoRefusal(clinicName, clinicPhone));
    }

    const details = parsed.details;

    // If they just sent "1" -> ask for details
    if (!details) {
      const linkLine = bookingLink ? `\n\nOr book here:\n${bookingLink}` : "";
      return twiml(
        res,
        `Please reply with: Full name + preferred day/time.\n\n` +
          `Example: "Sarah Khan, Friday morning".` +
          linkLine +
          `\n\n${footer(clinicName, clinicPhone)}`
      );
    }

    // If they sent "1 - details" -> acknowledge (demo capture)
    return twiml(res, `Thanks. Got it. We’ll confirm shortly.\n\n${footer(clinicName, clinicPhone)}`);
  } catch (_) {
    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const clinicPhone = process.env.CLINIC_PHONE || "855-393-0900";
    return twiml(res, demoRefusal(clinicName, clinicPhone));
  }
}

function menuText(clinicName, clinicPhone) {
  return (
    `Sorry we missed you.\n\n` +
    `Reply:\n` +
    `1 = Book a New Patient Exam\n\n` +
    `${footer(clinicName, clinicPhone)}`
  );
}

function demoRefusal(clinicName, clinicPhone) {
  return (
    `Since I am the demo version I cannot be able to do that.\n` +
    `I can help you book a New Patient Exam or answer basic clinic questions.\n\n` +
    `${footer(clinicName, clinicPhone)}`
  );
}

// Accept "1" or "1 - ..." or "1: ..."
function parseOneOnly(msg) {
  const s = String(msg || "").trim();
  if (!s) return null;
  if (s[0] !== "1") return null;

  const prefixRegex = new RegExp(`^\\s*1\\s*([\\-:])?\\s*`, "i");
  const details = s.replace(prefixRegex, "").trim();
  return { details: details || "" };
}

function normalizeYesNo(msg) {
  const s = String(msg || "").trim().toLowerCase();
  if (s === "yes" || s === "y") return "YES";
  if (s === "no" || s === "n") return "NO";
  return "";
}

function footer(clinicName, clinicPhone) {
  return `${clinicName},\nT - ${clinicPhone}`;
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
