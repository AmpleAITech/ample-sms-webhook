export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // TODO: verify secret + send SMS (we’ll add next)
  return res.status(200).json({ received: true });
}
