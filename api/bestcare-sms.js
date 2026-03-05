// api/bestcare-sms.js
// Twilio inbound SMS webhook (POST, x-www-form-urlencoded).
// BULLETPROOF DEMO MODE (NEW PATIENT ONLY):
// - YES/NO works for confirmation texts
// - "1" starts a New Patient request flow
// - Next SMS from same number within 10 min is treated as "details" and we reply:
//   "Thanks. Got it. We’ll confirm shortly."
// - Anything else => demo refusal

import { Redis } from "@upstash/redis";

export const config = {
  api: { bodyParser: false },
};

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const raw = await readRawBody(req);
  const params = new URLSearchParams(raw);

  const from = String(params.get("From") || "").trim();
  const msgRaw = String(params.get("Body") || "").trim();

  const clinicName = process.env.CLINIC_NAME || "Huron Dental Centre";
  const clinicPhone = process.env.CLINIC_PHONE || "855-393-0900";
  const bookingLink = process.env.CAL_BOOKING_LINK || "";

  if (!from) return twiml(res, `Sorry — missing phone number.\n\n${footer(clinicName, clinicPhone)}`);

  // Normalize message
  const msg = msgRaw;

  // YES/NO confirmations
  const yn = normalizeYesNo(msg);
  if (yn === "YES") {
    return twiml(
      res,
      `Thanks for confirming.\nWe look forward to seeing you.\n\n${footer(clinicName, clinicPhone)}`
    );
  }
  if (yn === "NO") {
    return twiml(
      res,
      `No problem — we’ve noted you can’t make it.\nPlease call us if you need to reschedule.\n\n${footer(
        clinicName,
        clinicPhone
      )}`
    );
  }

  // Check if this number is in "awaiting details" state
  const stateKey = `sms:awaiting_details:${from}`;
  const awaiting = await redis.get(stateKey);

  // If they are in the details step, accept ANY text as details and acknowledge
  if (awaiting) {
    // Clear state immediately (prevents loops)
    await redis.del(stateKey);

    return twiml(res, `Thanks. Got it. We’ll confirm shortly.\n\n${footer(clinicName, clinicPhone)}`);
  }

  // Start flow ONLY if they text "1" (or "1 " etc.)
  if (isOneOnly(msg)) {
    // Set state for 10 minutes
    await redis.set(stateKey, "1", { ex: 600 });

    const linkLine = bookingLink ? `\n\nOr book here:\n${bookingLink}` : "";

    return twiml(
      res,
      `Please reply with: Full name + preferred day/time.\n\n` +
        `Example: "Sarah Khan, Friday morning".` +
        linkLine +
        `\n\n${footer(clinicName, clinicPhone)}`
    );
  }

  // Anything else => demo refusal
  return twiml(res, demoRefusal(clinicName, clinicPhone));
}

function isOneOnly(msg) {
  const s = String(msg || "").trim();
  return s === "1";
}

function normalizeYesNo(msg) {
  const s = String(msg || "").trim().toLowerCase();
  if (s === "yes" || s === "y") return "YES";
  if (s === "no" || s === "n") return "NO";
  return "";
}

function demoRefusal(clinicName, clinicPhone) {
  return (
    `Since I am the demo version I cannot be able to do that. ` +
    `I can help you book a New Patient Exam or answer basic clinic questions.\n\n` +
    `${footer(clinicName, clinicPhone)}`
  );
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

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
