import "dotenv/config";
import express from "express";
import helmet from "helmet";
import { fileURLToPath } from "node:url";
import { z, ZodError } from "zod";
import {
  pool,
  rows,
  transaction,
  lockUsers,
  requireThat,
  utc,
  Problem,
} from "./db.js";
import {
  checkConfig,
  demo,
  origin,
  sessionMiddleware,
  authenticated,
  administrator,
  requestOtp,
  verifyOtp,
  newSession,
} from "./auth.js";
import {
  requestSession,
  actSession,
  resolveDispute,
  resolveStalledSession,
  overlap,
} from "./sessions.js";
import { community, saveProfile, requireProfile } from './community.js';
import { challenges, challengeGate } from './challenges.js';
import { verifyHubIdentity } from './hub-identity.js';
checkConfig();
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "script-src": [
          "'self'",
          "https://www.google.com",
          "https://www.gstatic.com",
        ],
        "frame-src": ["https://www.google.com", "https://recaptcha.google.com"],
        "connect-src": ["'self'", "https://www.google.com"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "upgrade-insecure-requests": demo ? null : [],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(
  express.json({
    limit: "18mb",
    verify: (req, res, buffer) => {
      req.rawBody = buffer;
    },
  }),
);
app.get("/health", async (req, res) => {
  try {
    await rows("SELECT 1");
    res.json({ ok: true });
  } catch {
    res
      .status(503)
      .json({
        ok: false,
        message: "MySQL is not configured. Run the local setup script.",
      });
  }
});
// Public hosting exposes only health checks without a signed hub request.
app.use((req,res,next)=>{
  if(process.env.HUB_ONLY !== 'true') return next();
  try { requireThat(verifyHubIdentity(req), 'Open SkillSwap through PunithHub.', 403); next(); }
  catch(error){ next(error); }
});
app.use("/api", sessionMiddleware, (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.get("/api/session", (req, res) =>
  res.json({
    user: req.session.user_id
      ? {
          id: req.session.user_id,
          email: req.session.email,
          display_name: req.session.display_name,
          role: req.session.role,
        }
      : null,
    csrf: req.session.csrf,
    demo,
    site_key: process.env.RECAPTCHA_SITE_KEY || "",
    hub_origin: process.env.HUB_ORIGIN || "",
    hub: !!req.session.hub,
    github_configured: !!(
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ),
  }),
);
app.post("/api/auth/request", async (req, res) =>
  res.json(await requestOtp(req)),
);
app.post("/api/auth/verify", async (req, res) =>
  res.json(await verifyOtp(req, res)),
);
app.post("/api/auth/logout", async (req, res) => {
  await rows("DELETE FROM web_sessions WHERE token_hash=?", [
    req.session.token_hash,
  ]);
  await newSession(res);
  res.json({ ok: true });
});
app.use("/api", authenticated);
app.use('/api',challengeGate,challenges);
app.use('/api', requireProfile, community);
app.use('/api', (req,res,next)=>{
  if(!['GET','HEAD','OPTIONS'].includes(req.method))res.on('finish',()=>{
    rows("INSERT INTO audit_events(actor_id,action,entity_type,details) VALUES(?,?,'api',?)",[req.session.user_id,req.method+' '+req.path.replace(/\/[a-f0-9]{48}/g,'/:file'),JSON.stringify({status:res.statusCode})]).catch(()=>{});
  });next();
});
const id = (value) => z.coerce.number().int().positive().safe().parse(value);
const offerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  category: z.enum([
    "Technology",
    "Design",
    "Languages",
    "Academics",
    "Music",
    "Life skills",
  ]),
  level: z.enum(["Beginner", "Intermediate", "Advanced"]),
  mode: z.enum(["Online", "Campus"]),
  description: z.string().trim().min(15).max(2000),
});
app.get("/api/me", async (req, res) =>
  res.json(
    (
      await rows(
        "SELECT id,email,display_name,department,bio,interests,role,age,college,study_year,learning_goals,preferred_mode,onboarded,is_demo FROM users WHERE id=?",
        [req.session.user_id],
      )
    )[0],
  ),
);
app.patch("/api/me", async (req, res) => {
  res.json(await saveProfile(req.session.user_id,req.body));
});
app.get("/api/dashboard", async (req, res) => {
  const uid = req.session.user_id;
  const [wallet] = await rows(
    "SELECT balance,held_balance,balance-held_balance AS available FROM wallets WHERE user_id=?",
    [uid],
  );
  const [stats] = await rows(
    "SELECT COUNT(*) AS total,SUM(s.status='COMPLETED') AS completed,SUM(s.status='CONFIRMED') AS upcoming,SUM(s.status='PENDING' AND o.teacher_id=?) AS requests FROM sessions s JOIN availability_slots a ON a.id=s.slot_id JOIN offers o ON o.id=a.offer_id WHERE s.learner_id=? OR o.teacher_id=?",
    [uid, uid, uid],
  );
  res.json({ wallet, stats, challenge:req.learningChallenge });
});
app.get("/api/offers", async (req, res) => {
  const q = String(req.query.q || "").slice(0, 100),
    category = String(req.query.category || ""),
    mode = String(req.query.mode || ""),
    page = Math.max(0, Math.min(10000, Number.parseInt(req.query.page) || 0));
  const data = await rows(
    `SELECT o.*,sk.name,sk.category,u.display_name,u.department,u.is_demo,MIN(a.start_at) AS next_slot,(SELECT AVG(r.rating) FROM reviews r JOIN sessions ss ON ss.id=r.session_id JOIN availability_slots aa ON aa.id=ss.slot_id WHERE aa.offer_id=o.id) AS rating FROM offers o JOIN skills sk ON sk.id=o.skill_id JOIN users u ON u.id=o.teacher_id JOIN availability_slots a ON a.offer_id=o.id AND a.status='AVAILABLE' AND a.start_at>UTC_TIMESTAMP() WHERE o.active=1 AND u.active=1 AND (sk.name LIKE ? OR u.display_name LIKE ?) AND (?='' OR sk.category=?) AND (?='' OR o.mode=?) GROUP BY o.id,sk.name,sk.category,u.display_name,u.department,u.is_demo ORDER BY next_slot LIMIT 12 OFFSET ${page * 12}`,
    ["%" + q + "%", "%" + q + "%", category, category, mode, mode],
  );
  res.json(data);
});
app.get("/api/offers/mine", async (req, res) =>
  res.json(
    await rows(
      "SELECT o.*,sk.name,sk.category FROM offers o JOIN skills sk ON sk.id=o.skill_id WHERE o.teacher_id=? ORDER BY o.id DESC",
      [req.session.user_id],
    ),
  ),
);
app.get("/api/offers/:id/slots", async (req, res) =>
  res.json(
    await rows(
      "SELECT a.id,a.start_at,a.end_at FROM availability_slots a JOIN offers o ON o.id=a.offer_id JOIN users u ON u.id=o.teacher_id WHERE a.offer_id=? AND a.status='AVAILABLE' AND a.start_at>UTC_TIMESTAMP() AND o.active=1 AND u.active=1 ORDER BY a.start_at LIMIT 60",
      [id(req.params.id)],
    ),
  ),
);
app.post("/api/offers", async (req, res) => {
  const d = offerSchema.parse(req.body);
  const result = await transaction(async (c) => {
    await lockUsers(c, [req.session.user_id]);
    await rows(
      "INSERT IGNORE INTO skills(name,category) VALUES(?,?)",
      [d.name, d.category],
      c,
    );
    const [sk] = await rows("SELECT id FROM skills WHERE name=?", [d.name], c);
    return rows(
      "INSERT INTO offers(teacher_id,skill_id,level,mode,description) VALUES(?,?,?,?,?)",
      [req.session.user_id, sk.id, d.level, d.mode, d.description],
      c,
    );
  });
  res.status(201).json({ id: result.insertId });
});
app.patch("/api/offers/:id", async (req, res) => {
  const d = z
    .object({
      description: z.string().trim().min(15).max(2000),
      active: z.boolean(),
    })
    .parse(req.body);
  await transaction(async (c) => {
    await lockUsers(c, [req.session.user_id]);
    const [o] = await rows(
      "SELECT * FROM offers WHERE id=? FOR UPDATE",
      [id(req.params.id)],
      c,
    );
    requireThat(
      o?.teacher_id === req.session.user_id,
      "You can edit only your offers",
      403,
    );
    await rows(
      "UPDATE offers SET description=?,active=? WHERE id=?",
      [d.description, d.active, o.id],
      c,
    );
  });
  res.json({ ok: true });
});
app.post("/api/offers/:id/slots", async (req, res) => {
  const start = new Date(
      z.string().datetime({ offset: true }).parse(req.body.start_at),
    ),
    end = new Date(start.getTime() + 3600000);
  requireThat(
    start > Date.now() && start < Date.now() + 366 * 86400000,
    "Choose a future slot within one year",
  );
  await transaction(async (c) => {
    const uid = req.session.user_id;
    await lockUsers(c, [uid]);
    const [o] = await rows(
      "SELECT * FROM offers WHERE id=? FOR UPDATE",
      [id(req.params.id)],
      c,
    );
    requireThat(
      o?.teacher_id === uid && o.active,
      "Only your active offers can receive slots",
      403,
    );
    const clash = await rows(
      "SELECT a.id FROM availability_slots a JOIN offers o ON o.id=a.offer_id WHERE o.teacher_id=? AND a.status IN ('AVAILABLE','BOOKED') AND a.start_at<? AND a.end_at>? LIMIT 1",
      [uid, utc(end), utc(start)],
      c,
    );
    requireThat(
      !clash.length && !(await overlap(c, [uid, uid], utc(start), utc(end))),
      "This slot overlaps an existing slot or session",
      409,
    );
    await rows(
      "INSERT INTO availability_slots(offer_id,start_at,end_at) VALUES(?,?,?)",
      [o.id, utc(start), utc(end)],
      c,
    );
  });
  res.status(201).json({ ok: true });
});
app.get("/api/sessions", async (req, res) =>
  res.json(
    await rows(
      `SELECT s.*,a.start_at,a.end_at,o.teacher_id,sk.name,sk.category,teacher.display_name AS teacher_name,learner.display_name AS learner_name,r.rating,(SELECT COUNT(*) FROM completion_confirmations c WHERE c.session_id=s.id) AS confirmations,(SELECT COUNT(*) FROM completion_confirmations c WHERE c.session_id=s.id AND c.user_id=?) AS my_confirmation,(s.status='CONFIRMED' AND a.end_at<DATE_SUB(UTC_TIMESTAMP(),INTERVAL 48 HOUR)) AS stalled FROM sessions s JOIN availability_slots a ON a.id=s.slot_id JOIN offers o ON o.id=a.offer_id JOIN skills sk ON sk.id=o.skill_id JOIN users teacher ON teacher.id=o.teacher_id JOIN users learner ON learner.id=s.learner_id LEFT JOIN reviews r ON r.session_id=s.id WHERE s.learner_id=? OR o.teacher_id=? ORDER BY a.start_at DESC LIMIT 100`,
      [req.session.user_id, req.session.user_id, req.session.user_id],
    ),
  ),
);
app.post("/api/sessions", async (req, res) =>
  res
    .status(201)
    .json(await requestSession(req.session.user_id, id(req.body.slot_id))),
);
app.post("/api/sessions/:id/:action", async (req, res) =>
  res.json(
    await actSession(
      req.session.user_id,
      id(req.params.id),
      req.params.action,
      req.body,
    ),
  ),
);
app.get("/api/wallet", async (req, res) => {
  const uid = req.session.user_id;
  res.json({
    wallet: (
      await rows(
        "SELECT *,balance-held_balance AS available FROM wallets WHERE user_id=?",
        [uid],
      )
    )[0],
    transfers: await rows(
      "SELECT id,session_id,amount,type,payer_id,payee_id,created_at FROM credit_transfers WHERE payer_id=? OR payee_id=? ORDER BY id DESC LIMIT 100",
      [uid, uid],
    ),
    holds: await rows(
      "SELECT * FROM credit_holds WHERE learner_id=? ORDER BY id DESC LIMIT 100",
      [uid],
    ),
  });
});
app.post("/api/reviews", async (req, res) => {
  const d = z
    .object({
      session_id: z.number().int().positive(),
      rating: z.number().int().min(1).max(5),
      text: z.string().max(2000).default(""),
    })
    .parse(req.body);
  const [s] = await rows("SELECT learner_id,status FROM sessions WHERE id=?", [
    d.session_id,
  ]);
  requireThat(
    s?.learner_id === req.session.user_id && s.status === "COMPLETED",
    "Only the learner can review a completed session",
    403,
  );
  await rows("INSERT INTO reviews(session_id,rating,text) VALUES(?,?,?)", [
    d.session_id,
    d.rating,
    d.text,
  ]);
  res.status(201).json({ ok: true });
});
app.use("/api/admin", administrator);
app.get('/api/admin/logs',async(req,res)=>{
  const start=req.query.start?z.string().date().parse(req.query.start):'1970-01-01';
  const end=req.query.end?z.string().date().parse(req.query.end):'2100-01-01';
  const action=String(req.query.action||'').slice(0,100);
  const offset=Math.max(0,Number.parseInt(req.query.offset)||0);
  res.json(await rows(`SELECT a.id,a.created_at AS at,u.email AS actor,a.action,a.entity_type,a.entity_id,a.details FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.created_at>=? AND a.created_at<DATE_ADD(?,INTERVAL 1 DAY) AND (?='' OR a.action LIKE ?) ORDER BY a.id LIMIT 1000 OFFSET ${offset}`,[start,end,action,'%'+action+'%']));
});
app.get("/api/admin/reports", async (req, res) =>
  res.json({
    popular: await rows(
      "SELECT * FROM popular_skills ORDER BY completed_sessions DESC LIMIT 50",
    ),
    users: await rows(
      "SELECT id,email,display_name,role,active FROM users ORDER BY id DESC LIMIT 100",
    ),
    offers: await rows(
      "SELECT o.id,o.active,sk.name,u.display_name FROM offers o JOIN skills sk ON sk.id=o.skill_id JOIN users u ON u.id=o.teacher_id ORDER BY o.id DESC LIMIT 100",
    ),
    disputes: await rows(
      "SELECT d.*,sk.name FROM disputes d JOIN sessions s ON s.id=d.session_id JOIN availability_slots a ON a.id=s.slot_id JOIN offers o ON o.id=a.offer_id JOIN skills sk ON sk.id=o.skill_id ORDER BY d.id DESC LIMIT 100",
    ),
    stalled: await rows(
      "SELECT s.id,s.status,s.learner_id,a.start_at,a.end_at,teacher.display_name AS teacher_name,learner.display_name AS learner_name,sk.name AS skill_name FROM sessions s JOIN availability_slots a ON a.id=s.slot_id JOIN offers o ON o.id=a.offer_id JOIN skills sk ON sk.id=o.skill_id JOIN users teacher ON teacher.id=o.teacher_id JOIN users learner ON learner.id=s.learner_id WHERE s.status='CONFIRMED' AND a.start_at<UTC_TIMESTAMP() ORDER BY a.start_at LIMIT 200",
    ),
    audit: await rows("SELECT * FROM audit_events ORDER BY id DESC LIMIT 100"),
    reconciliation: await rows(
      "SELECT w.user_id,w.balance,w.held_balance,COALESCE((SELECT SUM(t.amount) FROM credit_transfers t WHERE t.payee_id=w.user_id),0)-COALESCE((SELECT SUM(t.amount) FROM credit_transfers t WHERE t.payer_id=w.user_id),0) AS ledger_balance,COALESCE((SELECT SUM(h.amount) FROM credit_holds h WHERE h.learner_id=w.user_id AND h.status='ACTIVE'),0) AS ledger_held FROM wallets w",
    ),
  }),
);
app.post('/api/admin/sessions/:id/resolve',async(req,res)=>res.json(await resolveStalledSession(req.session.user_id,id(req.params.id),req.body.decision,req.body.reason)));
app.post("/api/admin/disputes/:id", async (req, res) =>
  res.json(
    await resolveDispute(
      req.session.user_id,
      id(req.params.id),
      req.body.decision,
      req.body.reason,
    ),
  ),
);
app.patch("/api/admin/users/:id", async (req, res) => {
  const uid = id(req.params.id),
    active = z.boolean().parse(req.body.active);
  requireThat(uid !== req.session.user_id, "You cannot deactivate yourself");
  await transaction(async (c) => {
    await lockUsers(c, [uid]);
    const [u] = await rows("SELECT email FROM users WHERE id=?", [uid], c);
    requireThat(
      u.email !== process.env.OWNER_EMAIL,
      "The owner cannot be deactivated",
    );
    await rows("UPDATE users SET active=? WHERE id=?", [active, uid], c);
    if (!active)
      await rows("DELETE FROM web_sessions WHERE user_id=?", [uid], c);
    await rows(
      "INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES(?,'moderate','user',?,?)",
      [req.session.user_id, uid, JSON.stringify({ active })],
      c,
    );
  });
  res.json({ ok: true });
});
app.patch("/api/admin/offers/:id", async (req, res) => {
  const active = z.boolean().parse(req.body.active),
    oid = id(req.params.id);
  await rows("UPDATE offers SET active=? WHERE id=?", [active, oid]);
  await rows(
    "INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES(?,'moderate','offer',?,?)",
    [req.session.user_id, oid, JSON.stringify({ active })],
  );
  res.json({ ok: true });
});
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpoint not found" }),
);
const dist = fileURLToPath(new URL("../dist/", import.meta.url));
app.use(express.static(dist));
app.get("/{*path}", (req, res) => res.sendFile(dist + "index.html"));
app.use((error, req, res, next) => {
  const status =
    error instanceof ZodError
      ? 400
      : error.status || (error.code === "ER_DUP_ENTRY" ? 409 : 503);
  res
    .status(status)
    .json({
      error:
        error instanceof ZodError
          ? "Check the form values and try again"
          : error instanceof Problem
            ? error.message
            : error.code === "ER_DUP_ENTRY"
              ? "This record already exists. Refresh and try again."
              : "Service unavailable. Check database setup or retry shortly.",
    });
});
const host = demo ? "127.0.0.1" : "0.0.0.0";
const expireChallenges=()=>rows("UPDATE learning_challenges SET status='OVERDUE' WHERE status='OPEN' AND due_at<=UTC_TIMESTAMP()").catch(()=>console.error('Challenge deadline sweep unavailable; request-time enforcement remains active.'));
expireChallenges();setInterval(expireChallenges,60000).unref();
app.listen(Number(process.env.PORT || 8790), host, () =>
  console.log(
    `SkillSwap listening on ${host}:${process.env.PORT || 8790}; ${demo ? "LOCAL DEMO — no email sent" : "production"}`,
  ),
);
