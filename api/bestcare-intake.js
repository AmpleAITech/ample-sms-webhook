// api/bestcare-intake.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const sheetsUrl = process.env.BESTCARE_SHEETS_WEBHOOK_URL;
    if (!sheetsUrl) {
      return res.status(500).json({ ok: false, error: "Missing BESTCARE_SHEETS_WEBHOOK_URL" });
    }

    const body = req.body || {};

    // Normalize to your Google Sheet schema
    const intake = {
      source: body.source || "phone",
      scenario: body.scenario || "new_patient",
      first_name: body.first_name || "",
      last_name: body.last_name || "",
      phone: body.phone || "",
      email: body.email || "",
      gender: body.gender || "",
      reason_for_appointment: body.reason_for_appointment || "",
      consent: body.consent || "verbal_yes",
      urgent_flag: body.urgent_flag || "no",
      notes: body.notes || "",
      call_sid: body.call_sid || "",
      recording_url: body.recording_url || ""
    };

    // Forward to Apps Script (avoid redirect pitfalls)
    const forwardRes = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intake),
      redirect: "follow"
    });

    const text = await forwardRes.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }

    // Demo-safe: return 200 even if Sheets fails
    return res.status(200).json({
      ok: true,
      sheets_ok: forwardRes.ok,
      sheets_status: forwardRes.status,
      sheets_response: parsed
    });
  } catch (err) {
    return res.status(200).json({ ok: true, sheets_ok: false, error: String(err) });
  }
}
