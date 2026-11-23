import crypto from "node:crypto";
import { rows, transaction, requireThat, utc, Problem } from "./db.js";
import { hubIdentity } from "./hub-identity.js";
export const random = () => crypto.randomBytes(24).toString("hex");
export const hash = (v) => crypto.createHash("sha256").update(v).digest("hex");
const sign = (v) =>
  crypto
    .createHmac("sha256", process.env.SESSION_SECRET)
    .update(v)
    .digest("hex");
export const demo = process.env.LOCAL_DEMO === "true";
export const origin = process.env.PUBLIC_ORIGIN || "http://127.0.0.1:8790";
export function checkConfig() {
  requireThat(process.env.NODE_ENV !== 'production' || !demo,'LOCAL_DEMO must be false in production',500);
  if(process.env.NODE_ENV==='production'){
    for(const k of ['MYSQL_HOST','MYSQL_DATABASE','MYSQL_USER','MYSQL_PASSWORD']) requireThat(process.env[k],`Missing ${k}`,500);
    requireThat(process.env.MYSQL_SSL==='true','MYSQL_SSL=true is required for production database connections',500);
    requireThat(process.env.PUBLIC_ORIGIN,'Set PUBLIC_ORIGIN to the production HTTPS URL',500);
  }
  requireThat(
    process.env.SESSION_SECRET?.length >= 32,
    "Configure a random SESSION_SECRET (32+ characters)",
    500,
  );
  const url = new URL(origin);
  if (demo)
    requireThat(
      ["127.0.0.1", "localhost"].includes(url.hostname),
      "Demo mode is loopback-only",
      500,
    );
  else {
    requireThat(url.protocol === "https:", "Production requires HTTPS", 500);
    for (const k of [
      "BREVO_API_KEY",
      "BREVO_SENDER_EMAIL",
      "RECAPTCHA_SITE_KEY",
      "RECAPTCHA_SECRET_KEY",
    ])
      requireThat(process.env[k], `Missing ${k}`, 500);
  }
}
function cookie(res, token) {
  res.cookie("skillswap_session", token, {
    httpOnly: true,
    secure: !demo,
    sameSite: "lax",
    path: "/",
    maxAge: 3600000,
  });
}
export async function newSession(res, userId = null) {
  const token = random(),
    csrf = random(),
    expires = utc(Date.now() + 3600000);
  await rows(
    "INSERT INTO web_sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
    [hash(token), userId, csrf, expires],
  );
  cookie(res, token);
  return { token_hash: hash(token), user_id: userId, csrf };
}
export async function sessionMiddleware(req, res, next) {
  try {
    const token = String(req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("skillswap_session="))
      ?.split("=")[1];
    let s = await hubIdentity(req);
    if (!s)
      s = token
        ? (
            await rows(
              "SELECT s.*,u.email,u.display_name,u.role,u.active FROM web_sessions s LEFT JOIN users u ON u.id=s.user_id WHERE token_hash=? AND expires_at>UTC_TIMESTAMP()",
              [hash(token)],
            )
          )[0]
        : null;
    if (s?.user_id && !s.active) {
      await rows("DELETE FROM web_sessions WHERE token_hash=?", [s.token_hash]);
      s = null;
    }
    req.session = s || (await newSession(res));
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      requireThat(
        req.headers["x-csrf-token"] === req.session.csrf,
        "Refresh the page and retry",
        403,
      );
      if (req.headers.origin)
        requireThat(
          req.headers.origin === origin ||
            req.headers.origin === process.env.HUB_ORIGIN,
          "Invalid request origin",
          403,
        );
    }
    next();
  } catch (e) {
    next(e);
  }
}
export function authenticated(req, res, next) {
  try {
    requireThat(req.session.user_id, "Sign in to continue", 401);
    next();
  } catch (e) {
    next(e);
  }
}
export function administrator(req, res, next) {
  try {
    requireThat(
      req.session.user_id && req.session.role === "admin",
      "Administrator access required",
      403,
    );
    next();
  } catch (e) {
    next(e);
  }
}
export async function rateLimit(label, limit, seconds) {
  await transaction(async (c) => {
    const key = hash(label);
    await rows(
      "INSERT IGNORE INTO rate_limits(bucket,hits,reset_at) VALUES(?,0,?)",
      [key, utc(Date.now() + seconds * 1000)],
      c,
    );
    const [r] = await rows(
      "SELECT *,reset_at<=UTC_TIMESTAMP() AS expired FROM rate_limits WHERE bucket=? FOR UPDATE",
      [key],
      c,
    );
    requireThat(
      r.expired || r.hits < limit,
      "Too many attempts. Please try later.",
      429,
    );
    await rows(
      "UPDATE rate_limits SET hits=?,reset_at=? WHERE bucket=?",
      [
        r.expired ? 1 : r.hits + 1,
        r.expired ? utc(Date.now() + seconds * 1000) : r.reset_at,
        key,
      ],
      c,
    );
  });
}
export async function verifyCaptcha(token) {
  if (demo) {
    requireThat(token === "local-preview", "Confirm the local demo check");
    return;
  }
  requireThat(
    typeof token === "string" && token.length > 10 && token.length < 8192,
    "Complete the robot check",
  );
  let body;
  try {
    const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      body: new URLSearchParams({
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: token,
      }),
      signal: AbortSignal.timeout(12000),
    });
    body = await r.json();
  } catch {
    throw new Problem("Robot verification unavailable. Please retry.", 503);
  }
  requireThat(
    body.success &&
      [
        new URL(origin).hostname,
        ...(process.env.HUB_ORIGIN
          ? [new URL(process.env.HUB_ORIGIN).hostname]
          : []),
      ].includes(body.hostname),
    "Robot verification failed",
  );
  try {
    await rows("INSERT INTO captcha_tokens(token_hash) VALUES(?)", [
      hash(token),
    ]);
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY")
      throw new Problem("Robot check already used. Please retry.");
    throw e;
  }
}
export async function createAccount(c, email, profile) {
  let [u] = await rows(
    "SELECT * FROM users WHERE email=? FOR UPDATE",
    [email],
    c,
  );
  if (u) {
    requireThat(u.active, "Account unavailable", 403);
    if(u.is_demo){
      requireThat(demo,'Fictional demo profiles are available only in local demo mode',403);
      return u;
    }
    return u;
  }
  requireThat(profile?.display_name, "Register your profile first");
  const role = email === process.env.OWNER_EMAIL ? "admin" : "student";
  const result = await rows(
    "INSERT INTO users(email,display_name,department,role) VALUES(?,?,?,?)",
    [email, profile.display_name, profile.department || "", role],
    c,
  );
  const id = result.insertId;
  await rows("INSERT INTO wallets(user_id,balance) VALUES(?,3)", [id], c);
  await rows(
    "INSERT INTO credit_transfers(payee_id,amount,type,idempotency_key) VALUES(?,3,'GRANT',?)",
    [id, `starter:${id}`],
    c,
  );
  return { id };
}
export async function requestOtp(req) {
  const { email: raw, captcha_token, profile } = req.body;
  const email = String(raw || "")
    .trim()
    .toLowerCase();
  requireThat(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254,
    "Enter a valid email",
  );
  if (profile)
    requireThat(
      typeof profile.display_name === "string" &&
        profile.display_name.trim().length >= 2 &&
        profile.display_name.length <= 80 &&
        String(profile.department || "").length <= 100,
      "Add your name (2–80 characters)",
    );
  await rateLimit("ip:" + req.ip, 20, 3600);
  await rateLimit("email:" + email, 8, 3600);
  await rateLimit("cooldown:" + email, 1, 30);
  await verifyCaptcha(captcha_token);
  const id = random(),
    code = crypto.randomInt(1000000).toString().padStart(6, "0");
  await transaction(async (c) => {
    await rows(
      "UPDATE otp_challenges SET used=1 WHERE session_hash=?",
      [req.session.token_hash],
      c,
    );
    await rows(
      "INSERT INTO otp_challenges(id,session_hash,email,code_hash,profile,expires_at) VALUES(?,?,?,?,?,?)",
      [
        id,
        req.session.token_hash,
        email,
        sign(id + ":" + code),
        profile
          ? JSON.stringify({
              display_name: profile.display_name.trim(),
              department: String(profile.department || "").trim(),
            })
          : null,
        utc(Date.now() + 300000),
      ],
      c,
    );
  });
  if (!demo) {
    try {
      const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: {
            email: process.env.BREVO_SENDER_EMAIL,
            name: "PunithHub · SkillSwap",
          },
          to: [{ email }],
          subject: "Your SkillSwap sign-in code",
          textContent: `Your code is ${code}. It expires in 5 minutes. Do not share it.`,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) throw Error();
    } catch {
      await rows("UPDATE otp_challenges SET used=1 WHERE id=?", [id]);
      throw new Problem("Email delivery unavailable. Please retry.", 503);
    }
  }
  return { challenge_id: id, ...(demo ? { preview_code: code } : {}) };
}
export async function verifyOtp(req, res) {
  const { challenge_id, code } = req.body;
  requireThat(
    typeof challenge_id === "string" && /^\d{6}$/.test(String(code)),
    "Enter the six-digit code",
  );
  let userId, error;
  await transaction(async (c) => {
    const [o] = await rows(
      "SELECT *,expires_at<=UTC_TIMESTAMP() AS expired FROM otp_challenges WHERE id=? FOR UPDATE",
      [challenge_id],
      c,
    );
    requireThat(
      o &&
        o.session_hash === req.session.token_hash &&
        !o.used &&
        !o.expired &&
        o.attempts < 5,
      "Code expired or unavailable",
    );
    await rows(
      "UPDATE otp_challenges SET attempts=attempts+1 WHERE id=?",
      [challenge_id],
      c,
    );
    if (
      !crypto.timingSafeEqual(
        Buffer.from(o.code_hash),
        Buffer.from(sign(challenge_id + ":" + code)),
      )
    ) {
      error = "Incorrect verification code";
      return;
    }
    let p = o.profile;
    if (typeof p === "string") p = JSON.parse(p);
    const u = await createAccount(c, o.email, p);
    userId = u.id;
    await rows(
      "UPDATE otp_challenges SET used=1 WHERE id=?",
      [challenge_id],
      c,
    );
    await rows(
      "DELETE FROM web_sessions WHERE token_hash=?",
      [req.session.token_hash],
      c,
    );
  });
  if (error) throw new Problem(error);
  await newSession(res, userId);
  return { ok: true };
}
