// Generates a personal access token for a user's cloud-synced portfolio.

import crypto from "node:crypto";

export default async function handler(req, res) {
  const raw = crypto.randomBytes(18).toString("base64url"); // ~24 chars, URL-safe
  const token = `tbc_${raw}`;
  res.status(200).json({ token });
}
