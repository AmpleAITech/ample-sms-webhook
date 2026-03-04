// api/bestcare-sms.js
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const TTL_SECONDS = 60 * 10; // 10 minutes

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const body = req.body || {};
    const from = String(body.From || "").trim();
    const msgRaw = String(body.Body || "").trim();

    const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
    const loc1 = process.env.CLINIC_LOCATION_1 || "Mississauga";
    const loc2 = process.env.CLINIC_LOCATION_2 || "Milton";
    const clinicPhone = process.env.CLINIC_PHONE || process.env.TWILIO_FROM_NUMBER || "";
    const bookingLink = process.env.CAL_BOOKING_LINK || "";
    const noticeHours = Number(process.env.RESCHEDULE_NOTICE_HOURS || 48);

    if (!from) return twiml(res, "Sorry — missing phone number. Please try again.");
    if (!msgRaw) return twiml(res, menuText(clinicName, noticeHours));

    // 1) YES/NO confirmations (works for booking + reschedule confirmations)
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

    // Redis keys per phone number
    const key = `sms:${from}`;
    const state = await redis.get(key); // { step, intent } or null

    // 2) If no state, we expect intent (1/2/3)
    if (!state) {
      const intent = parseIntent(msgRaw);
      if (!intent) {
        return twiml(
          res,
          `Your answer could not be interpreted.\n\n${menuText(clinicName, noticeHours)}`
        );
      }

      // save state: next step is location
      await redis.set(key, { step: "location", intent }, { ex: TTL_SECONDS });

      return twiml(res, locationText(loc1, loc2));
    }

    // 3) If waiting for location
    if (state.step === "location") {
      const loc = parseLocation(msgRaw);
      if (!loc) {
        return twiml(res, `Please reply with 1 or 2.\n\n${locationText(loc1, loc2)}`);
      }

      // save state: now collect details
      await redis.set(
        key,
        { step: "details", intent: state.intent, location: loc },
        { ex: TTL_SECONDS }
      );

      return twiml(
        res,
        detailsPrompt({
          clinicName,
          clinicPhone,
          bookingLink,
          noticeHours,
          intent: state.intent,
          location: loc === "1" ? loc1 : loc2,
        })
      );
    }

    // 4) If waiting for details: accept any message as details, acknowledge, then clear state
    if (state.step === "details") {
      // optional: you can store the details somewhere later. For now: just acknowledge.
      await redis.del(key);

      const locationName = state.location === "1" ? loc1 : loc2;

      if (state.intent === "book") {
        const linkLine = bookingLink ? `\nOptional booking link: ${bookingLink}` : "";
        return twiml(
          res,
          `Thanks — got it. ${clinicName} (${locationName}) will confirm shortly by text or call.${linkLine}`
        );
      }

      if (state.intent === "reschedule") {
        return twiml(
          res,
          `Thanks — got it. ${clinicName} (${locationName}) will confirm shortly.\nReminder: we ask for ${noticeHours} hours notice for reschedules.`
        );
      }

      return twiml(res, `Thanks — got it. ${clinicName} (${locationName}) will follow up shortly.`);
    }

    // Fallback: clear unknown state
    await redis.del(key);
    return twiml(res, menuText(clinicName, noticeHours));
  } catch (err) {
    return twiml(res, "Thanks — we received your message. If this is an emergency, please call 911.");
  }
}

// ---------- Copy blocks ----------

function menuText(clinicName, noticeHours) {
  return (
    `Sorry we missed you at ${clinicName}.\n` +
    `Reply:\n` +
    `1 = Book new patient exam\n` +
    `2 = Reschedule / change appointment (${noticeHours}h notice)\n` +
    `3 = Other`
  );
}

function locationText(loc1, loc2) {
  return `Which location?\n1 = ${loc1}\n2 = ${loc2}`;
}

function detailsPrompt({ clinicName, clinicPhone, bookingLink, noticeHours, intent, location }) {
  if (intent === "book") {
    const linkLine = bookingLink ? `\nOr book here: ${bookingLink}` : "";
    return (
      `Got it — ${clinicName} (${location}).\n` +
      `Please reply with: Full name + preferred day/time.\n` +
      `Example: "Sarah Khan, next Tue after 3pm".\n` +
      `You can also call T - ${clinicPhone}.` +
      linkLine
    );
  }

  if (intent === "reschedule") {
    return (
      `Sure — ${clinicName} (${location}).\n` +
      `Reminder: we ask for ${noticeHours} hours notice.\n` +
      `Please reply with: Full name + current appt day/time + preferred new time.\n` +
      `Example: "Sarah Khan, current Thu 2pm, want Fri morning".\n` +
      `You can also call T - ${clinicPhone}.`
    );
  }

  return (
    `No problem — ${clinicName} (${location}).\n` +
    `Please reply with: Full name + how we can help.\n` +
    `Example: "Sarah Khan, question about insurance".\n` +
    `You can also call T - ${clinicPhone}.`
  );
}

// ---------- Parsers ----------

function normalizeYesNo(msg) {
  const s = String(msg || "").trim().toLowerCase();
  if (s === "yes" || s === "y") return "YES";
  if (s === "no" || s === "n") return "NO";
  return "";
}

function parseIntent(msg) {
  const s = String(msg || "").trim().toLowerCase();
  if (s === "1" || s.startsWith("1")) return "book";
  if (s === "2" || s.startsWith("2")) return "reschedule";
  if (s === "3" || s.startsWith("3")) return "other";
  return "";
}

function parseLocation(msg) {
  const s = String(msg || "").trim();
  if (s === "1") return "1";
  if (s === "2") return "2";
  return "";
}

// ---------- TwiML ----------

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
