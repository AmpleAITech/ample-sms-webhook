// api/bestcare-sms.js
// Twilio inbound SMS webhook (POST, x-www-form-urlencoded).
// Handles:
// - YES/NO confirmation replies
// - Menu replies 1/2/3
// - Details-only replies after prompting (stateless, demo-safe)
// Enforces consistent SMS formatting + clinic footer.

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};
    const from = String(body.From || "").trim();
    const msgRaw = String(body.Body || "").trim();

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const clinicPhone = process.env.CLINIC_PHONE || "855-393-0900";
    const bookingLink = process.env.CAL_BOOKING_LINK || "";
    const noticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    if (!from) return twiml(res, `Sorry — missing phone number.\n\n${footer(clinicName, clinicPhone)}`);
    if (!msgRaw) return twiml(res, menuText(clinicName, clinicPhone, noticeHours));

    // -----------------------------
    // (A) YES / NO confirmations
    // -----------------------------
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
        `No problem — we’ve noted you can’t make it.\nPlease reply here or call to reschedule.\n\n${footer(
          clinicName,
          clinicPhone
        )}`
      );
    }

    // -----------------------------
    // (B) Menu replies 1 / 2 / 3
    // -----------------------------
    const parsed = parseMenuReply(msgRaw);

    // Details-only fallback (after we prompted for details)
    if (!parsed) {
      return twiml(res, `Thanks. Got it. We’ll confirm shortly.\n\n${footer(clinicName, clinicPhone)}`);
    }

    const { choice, details } = parsed;

    // If no details, prompt for details based on choice
    if (!details) {
      if (choice === "1") {
        const linkLine = bookingLink ? `\n\nOr book here:\n${bookingLink}` : "";
        return twiml(
          res,
          `Please reply with: Full name + preferred day/time.\n\n` +
            `Example: "Sarah Khan, next Tue after 3pm".` +
            linkLine +
            `\n\n${footer(clinicName, clinicPhone)}`
        );
      }

      if (choice === "2") {
        // EXACT format user requested
        return twiml(
          res,
          `Reminder: we ask for ${noticeHours} hours notice for reschedules.\n\n` +
            `Please reply with: Full name + current appt day/time + preferred new time.\n\n` +
            `Example: "Sarah Khan, current Thu 2pm, want Fri morning".\n\n` +
            `${footer(clinicName, clinicPhone)}`
        );
      }

      // choice === "3"
      return twiml(
        res,
        `Please reply with: Full name + how we can help.\n\n` +
          `Example: "Sarah Khan, question about insurance".\n\n` +
          `${footer(clinicName, clinicPhone)}`
      );
    }

    // They included details in the same message -> acknowledge
    if (choice === "1") {
      const linkLine = bookingLink ? `\n\nOptional booking link:\n${bookingLink}` : "";
      return twiml(
        res,
        `Thanks. Got it. We’ll confirm shortly.` + linkLine + `\n\n${footer(clinicName, clinicPhone)}`
      );
    }

    if (choice === "2") {
      return twiml(
        res,
        `Thanks. Got it. We’ll confirm shortly.\n\n${footer(clinicName, clinicPhone)}`
      );
    }

    // choice === "3"
    return twiml(res, `Thanks. Got it. We’ll confirm shortly.\n\n${footer(clinicName, clinicPhone)}`);
  } catch (_) {
    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const clinicPhone = process.env.CLINIC_PHONE || "855-393-0900";
    return twiml(res, `Thanks — we received your message.\n\n${footer(clinicName, clinicPhone)}`);
  }
}

function menuText(clinicName, clinicPhone, noticeHours) {
  return (
    `Sorry we missed you.\n\n` +
    `Reply:\n` +
    `1 = Book new patient exam\n` +
    `2 = Reschedule / change appointment (${noticeHours}h notice)\n` +
    `3 = Other\n\n` +
    `${footer(clinicName, clinicPhone)}`
  );
}

function parseMenuReply(msg) {
  const s = String(msg || "").trim();
  const firstChar = s[0];
  if (!["1", "2", "3"].includes(firstChar)) return null;

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
