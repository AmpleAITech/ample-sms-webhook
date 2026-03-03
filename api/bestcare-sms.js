// api/bestcare-sms.js
// Twilio inbound SMS webhook (POST, x-www-form-urlencoded)
// Accepts replies:
// 1 = book a telephone appointment
// 2 = change/reschedule an existing appointment
// 3 = other
// If message starts with 1/2/3, we ask for "Full name + details" next.
// If message is not 1/2/3, we treat it as the details and submit to Google Sheet.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method not allowed");
  }

  try {
    const body = req.body || {};
    const from = (body.From || "").trim();      // patient phone
    const msg = (body.Body || "").trim();       // patient message

    if (!from) {
      return twiml(res, "Sorry — missing phone number. Please try again.");
    }

    if (!msg) {
      return twiml(res, menuText());
    }

    const first = msg[0];
    const remainder = msg.slice(1).trim().replace(/^[-:]/, "").trim(); // allow "1 - ..." or "1: ..."

    // If they reply with just 1/2/3 (or "1", "2", "3"), ask for details
    if ((msg === "1") || (msg === "2") || (msg === "3")) {
      return twiml(res, detailsPrompt(first));
    }

    // If they start with 1/2/3 AND included details in same message, capture now
    if (first === "1" || first === "2" || first === "3") {
      const details = remainder || msg; // fallback to full message
      await submitToSheet({ from, choice: first, details, raw: msg });
      return twiml(res, confirmText());
    }

    // Otherwise treat as unstructured details and still capture
    await submitToSheet({ from, choice: "3", details: msg, raw: msg });
    return twiml(res, confirmText());

  } catch (err) {
    return twiml(res, "Thanks — we received your message. If urgent, please call 911.");
  }
}

function menuText() {
  return (
    "Sorry we missed you at Best Care Medical Centre.\n" +
    "Reply:\n" +
    "1 = Book a telephone appointment\n" +
    "2 = Change an existing appointment\n" +
    "3 = Other"
  );
}

function detailsPrompt(choice) {
  if (choice === "1") {
    return "Got it — please reply with your full name and reason (e.g., Sarah Khan, prescription refill).";
  }
  if (choice === "2") {
    return "Sure — please reply with your full name and your preferred day/time to change your appointment (e.g., Sarah Khan, Wed 3pm).";
  }
  return "Please reply with your full name and how we can help (e.g., Sarah Khan, question about referral).";
}

function confirmText() {
  return (
    "Thanks — we got it. Our team will confirm shortly.\n" +
    "If this is an emergency, please call 911."
  );
}

async function submitToSheet({ from, choice, details, raw }) {
  const endpoint = "https://ample-sms-webhook-demov1.vercel.app/api/bestcare-intake";

  let reason = details;
  let notes = "";

  if (choice === "1") notes = "SMS missed call: book telephone appointment";
  else if (choice === "2") notes = "SMS missed call: change existing appointment";
  else notes = "SMS missed call: other";

  // Light name parsing (optional). If not parseable, keep in notes.
  let first_name = "";
  let last_name = "";
  if (details.includes(",")) {
    const namePart = details.split(",")[0].trim();
    const parts = namePart.split(/\s+/);
    first_name = parts[0] || "";
    last_name = parts.slice(1).join(" ") || "";
  } else {
    notes += " | name not parsed";
  }

  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "sms",
      scenario: "missed_call",
      first_name,
      last_name,
      phone: from,
      email: "",
      gender: "",
      reason_for_appointment: reason,
      consent: "sms_opt_in_assumed",
      urgent_flag: "no",
      notes: `${notes} | raw="${raw}"`,
      call_sid: "",
      recording_url: ""
    })
  });
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
