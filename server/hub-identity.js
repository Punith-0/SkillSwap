import crypto from "node:crypto";
import { transaction, rows, requireThat } from "./db.js";
import { createAccount } from "./auth.js";
export function verifyHubIdentity(req) {
  const encoded = req.headers["x-punithhub-identity"],
    signature = req.headers["x-punithhub-signature"];
  if (!encoded && !signature) return null;
  const secret = process.env.HUB_BRIDGE_SECRET;
  requireThat(
    secret?.length >= 32 &&
      typeof encoded === "string" &&
      encoded.length < 8192 &&
      typeof signature === "string" &&
      /^[a-f0-9]{64}$/.test(signature),
    "Invalid hub identity",
    403,
  );
  const bodyHash = crypto
    .createHash("sha256")
    .update(req.rawBody || "")
    .digest("hex");
  const signed = [req.method, req.originalUrl, bodyHash, encoded].join("\n");
  const expected = crypto.createHmac("sha256", secret).update(signed).digest();
  requireThat(
    crypto.timingSafeEqual(expected, Buffer.from(signature, "hex")),
    "Invalid hub signature",
    403,
  );
  let who;
  try {
    who = JSON.parse(Buffer.from(encoded, "base64url").toString());
  } catch {
    requireThat(false, "Invalid hub identity", 403);
  }
  requireThat(
    Number.isFinite(who.at) &&
      Math.abs(Date.now() / 1000 - who.at) < 30 &&
      typeof who.email === "string" &&
      typeof who.sid === "string" &&
      typeof who.csrf === "string" &&
      who.csrf.length > 20,
    "Expired hub identity",
    403,
  );
  return who;
}
export async function hubIdentity(req) {
  const who = verifyHubIdentity(req);
  if (!who) return null;
  const user = await transaction(async (c) => {
    const u = await createAccount(c, who.email, {
      display_name: who.name || who.email.split("@")[0],
    });
    await rows(
      "UPDATE users SET role=? WHERE id=?",
      [who.manager ? "admin" : "student", u.id],
      c,
    );
    return (await rows("SELECT * FROM users WHERE id=?", [u.id], c))[0];
  });
  return {
    user_id: user.id,
    email: user.email,
    display_name: user.display_name,
    role: user.role,
    active: user.active,
    csrf: who.csrf,
    token_hash: crypto
      .createHash("sha256")
      .update("hub:" + who.sid)
      .digest("hex"),
    hub: true,
  };
}
