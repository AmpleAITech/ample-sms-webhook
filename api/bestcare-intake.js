// api/bestcare-intake.js
// Huron demo: Google Sheets intake is disabled.
// This endpoint remains as a safe no-op so any legacy calls won't break the deployment.

export default async function handler(req, res) {
  // Always 200 to avoid retries and keep demo stable
  return res.status(200).json({
    ok: true,
    disabled: true,
    message: "Intake forwarding is disabled for this demo (no Google Sheets).",
  });
}
