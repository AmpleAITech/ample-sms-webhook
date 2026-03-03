export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const sheetsUrl = process.env.BESTCARE_SHEETS_WEBHOOK_URL;
    if (!sheetsUrl) {
      return res.status(500).json({ ok: false, error: "Missing BESTCARE_SHEETS_WEBHOOK_URL" });
    }

    const data = req.body || {};

    // ---------- Helpers ----------
    function normalizeStr(v) {
      return v === null || v === undefined ? "" : String(v).trim();
    }

    function ensureNotes(obj, extra) {
      const cur = normalizeStr(obj.notes);
      obj.notes = cur ? `${cur} | ${extra}` : extra;
    }

    function parseNameReasonFromSms(detailsRaw) {
      let s = normalizeStr(detailsRaw);
      if (!s) return null;

      // Remove leading menu selection like "1 " / "2 " / "3 "
      s = s.replace(/^\s*[123]\s+/, "");

      // Primary split: first comma separates name + reason
      if (s.includes(",")) {
        const match = s.match(/^([^,]+),\s*(.+)$/);
        if (!match) return null;
        return { namePart: normalizeStr(match[1]), reasonPart: normalizeStr(match[2]), raw: detailsRaw };
      }

      // Fallback split: "Name - reason"
      if (s.includes(" - ")) {
        const parts = s.split(" - ");
        if (parts.length >= 2) {
          return {
            namePart: normalizeStr(parts[0]),
            reasonPart: normalizeStr(parts.slice(1).join(" - ")),
            raw: detailsRaw
          };
        }
      }

      return null;
    }

    function splitName(namePart) {
      const parts = normalizeStr(namePart).split(/\s+/).filter(Boolean);
      if (parts.length === 0) return { first: "", last: "" };
      return { first: parts[0], last: parts.slice(1).join(" ") };
    }

    // ---------- Normalize into your sheet schema ----------
    const intake = {
      source: normalizeStr(data.source) || "phone",
      scenario: normalizeStr(data.scenario) || "",
      first_name: normalizeStr(data.first_name),
      last_name: normalizeStr(data.last_name),
      phone: normalizeStr(data.phone),
      email: normalizeStr(data.email),
      gender: normalizeStr(data.gender),
      reason_for_appointment: normalizeStr(data.reason_for_appointment),
      consent: normalizeStr(data.consent) || "",
      urgent_flag: normalizeStr(data.urgent_flag) || "no",
      notes: normalizeStr(data.notes),
      call_sid: normalizeStr(data.call_sid),
      recording_url: normalizeStr(data.recording_url)
    };

    // ---------- Bulletproof normalization (scenario + consent) ----------
    (function normalize(intake) {
      const src = String(intake.source || "").trim().toLowerCase();
      const sc = String(intake.scenario || "").trim().toLowerCase();

      const scenarioMap = {
        // voice / generic
        "new_patient": "telephone_request",
        "new patient": "telephone_request",
        "telephone_appointment_request": "telephone_request",
        "telephone appointment request": "telephone_request",
        "appointment_request": "telephone_request",
        "appointment request": "telephone_request",
        "telephone_request": "telephone_request",

        "reschedule": "reschedule_request",
        "reschedule_request": "reschedule_request",
        "change_appointment": "reschedule_request",
        "change appointment": "reschedule_request",
        "cancel": "reschedule_request",
        "cancel_request": "reschedule_request",

        // sms
        "missed_call": "missed_call_sms",
        "missed call": "missed_call_sms",
        "missed_call_sms": "missed_call_sms"
      };

      intake.scenario = scenarioMap[sc] || (sc || (src === "sms" ? "missed_call_sms" : "telephone_request"));

      const c = String(intake.consent || "").trim().toLowerCase();
      if (c === "yes" || c === "y" || c === "true") intake.consent = "verbal_yes";
      else if (c === "no" || c === "n" || c === "false") intake.consent = "verbal_no";
    })(intake);

    // ---------- SMS parsing for missed_call details ----------
    const source = normalizeStr(intake.source).toLowerCase();
    const scenario = normalizeStr(intake.scenario).toLowerCase();

    const firstEmpty = !normalizeStr(intake.first_name);
    const lastEmpty = !normalizeStr(intake.last_name);

    // We normalize to "missed_call_sms" now
    if (source === "sms" && scenario === "missed_call_sms" && firstEmpty && lastEmpty) {
      const parsed = parseNameReasonFromSms(intake.reason_for_appointment);
      if (parsed) {
        const { first, last } = splitName(parsed.namePart);

        if (first) intake.first_name = first;
        if (last) intake.last_name = last;

        if (parsed.reasonPart) intake.reason_for_appointment = parsed.reasonPart;

        ensureNotes(intake, `raw_sms="${normalizeStr(parsed.raw)}"`);
      }
    }

    // ---------- Email placeholder (never ask for email) ----------
    // If email is empty, silently set placeholder using last 4 digits of phone when possible
    if (!normalizeStr(intake.email)) {
      const digits = normalizeStr(intake.phone).replace(/\D/g, "");
      const last4 = digits.length >= 4 ? digits.slice(-4) : String(Math.floor(1000 + Math.random() * 9000));
      intake.email = `noemail+${last4}@ampledemo.com`;
    }

    // ---------- Forward to Apps Script (append row) ----------
    const forwardRes = await fetch(sheetsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intake),
      redirect: "follow"
    });

    const text = await forwardRes.text();
    let parsedResp;
    try { parsedResp = JSON.parse(text); } catch { parsedResp = { raw: text }; }

    // Demo-safe: always return 200
    return res.status(200).json({
      ok: true,
      sheets_ok: forwardRes.ok,
      sheets_status: forwardRes.status,
      sheets_response: parsedResp,
      intake_preview: intake
    });

  } catch (err) {
    return res.status(200).json({ ok: true, sheets_ok: false, error: String(err) });
  }
}
