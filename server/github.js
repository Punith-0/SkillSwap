import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { rows, transaction, requireThat, utc, Problem } from "./db.js";
import { random, hash, origin } from "./auth.js";
export const projectManifest = z
  .object({
    version: z.literal(1),
    slug: z.string().regex(/^[a-z][a-z0-9-]{2,40}$/),
    title: z.string().min(2).max(80),
    description: z.string().min(15).max(300),
    frontend: z.object({
      entry: z.string().regex(/^(?!.*\.\.)[a-zA-Z0-9_./-]+\.html$/),
    }),
    runtime: z.literal("node"),
    database: z.object({
      engine: z.literal("mysql"),
      migrations: z
        .array(z.string().regex(/^(?!.*\.\.)[a-zA-Z0-9_/-]+\.sql$/))
        .min(1)
        .max(30),
    }),
    auth: z.literal("punithhub"),
  })
  .strict();
function encrypt(value) {
  const iv = crypto.randomBytes(12),
    key = crypto
      .createHash("sha256")
      .update(process.env.SESSION_SECRET)
      .digest(),
    c = crypto.createCipheriv("aes-256-gcm", key, iv);
  return [
    iv,
    Buffer.concat([c.update(value, "utf8"), c.final()]),
    c.getAuthTag(),
  ]
    .map((b) => b.toString("base64"))
    .join(".");
}
function decrypt(value) {
  const [iv, data, tag] = value.split(".").map((x) => Buffer.from(x, "base64")),
    c = crypto.createDecipheriv(
      "aes-256-gcm",
      crypto.createHash("sha256").update(process.env.SESSION_SECRET).digest(),
      iv,
    );
  c.setAuthTag(tag);
  return Buffer.concat([c.update(data), c.final()]).toString("utf8");
}
async function github(path, token) {
  const response = await fetch("https://api.github.com" + path, {
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  });
  requireThat(
    response.ok,
    "GitHub request failed. Reconnect or check repository access.",
    502,
  );
  return response.json();
}
export const githubRouter = express.Router();
githubRouter.get("/status", async (req, res) => {
  const [c] = await rows(
    "SELECT login FROM github_connections WHERE user_id=?",
    [req.session.user_id],
  );
  res.json({
    configured: !!(
      process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
    ),
    login: c?.login || null,
    imports: await rows(
      "SELECT id,repo,sha,manifest,status,updated_at FROM project_imports WHERE owner_id=?",
      [req.session.user_id],
    ),
  });
});
githubRouter.post("/connect", async (req, res) => {
  requireThat(
    process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET,
    "Configure the GitHub OAuth application first",
    503,
  );
  const state = random();
  await rows(
    "INSERT INTO github_oauth_states(state_hash,user_id,session_hash,expires_at) VALUES(?,?,?,?)",
    [
      hash(state),
      req.session.user_id,
      req.session.token_hash,
      utc(Date.now() + 600000),
    ],
  );
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID,
    redirect_uri:
      (req.session.hub
        ? process.env.HUB_ORIGIN + "/projects/skillswap/app"
        : origin) + "/api/github/callback",
    scope: "read:user",
    state,
  }).toString();
  res.json({ url: url.href });
});
githubRouter.get("/callback", async (req, res) => {
  requireThat(
    typeof req.query.state === "string" && typeof req.query.code === "string",
    "Invalid GitHub callback",
  );
  await transaction(async (c) => {
    const [s] = await rows(
      "SELECT * FROM github_oauth_states WHERE state_hash=? AND expires_at>UTC_TIMESTAMP() FOR UPDATE",
      [hash(req.query.state)],
      c,
    );
    requireThat(
      s &&
        s.user_id === req.session.user_id &&
        s.session_hash === req.session.token_hash,
      "GitHub connection expired or belongs to another session",
      403,
    );
    await rows(
      "DELETE FROM github_oauth_states WHERE state_hash=?",
      [hash(req.query.state)],
      c,
    );
  });
  const r = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code: req.query.code,
      redirect_uri:
        (req.session.hub
          ? process.env.HUB_ORIGIN + "/projects/skillswap/app"
          : origin) + "/api/github/callback",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const token = (await r.json()).access_token;
  requireThat(token, "GitHub connection failed", 502);
  const u = await github("/user", token);
  await rows(
    "INSERT INTO github_connections(user_id,login,encrypted_token) VALUES(?,?,?) ON DUPLICATE KEY UPDATE login=VALUES(login),encrypted_token=VALUES(encrypted_token)",
    [req.session.user_id, u.login, encrypt(token)],
  );
  res.redirect("/?view=github");
});
githubRouter.delete("/connection", async (req, res) => {
  await rows("DELETE FROM github_connections WHERE user_id=?", [
    req.session.user_id,
  ]);
  res.json({ ok: true });
});
async function connection(req) {
  const [c] = await rows("SELECT * FROM github_connections WHERE user_id=?", [
    req.session.user_id,
  ]);
  requireThat(c, "Connect GitHub first", 409);
  return { ...c, token: decrypt(c.encrypted_token) };
}
githubRouter.get("/repos", async (req, res) => {
  const c = await connection(req),
    page = Math.min(100, Math.max(1, Number.parseInt(req.query.page) || 1));
  const data = await github(
    `/user/repos?affiliation=owner&visibility=public&sort=updated&per_page=30&page=${page}`,
    c.token,
  );
  res.json(
    data
      .filter((r) => !r.private)
      .map((r) => ({
        name: r.full_name,
        description: r.description,
        updated_at: r.updated_at,
      })),
  );
});
githubRouter.post("/import", async (req, res) => {
  const c = await connection(req),
    repo = z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .parse(req.body.repo);
  requireThat(
    repo.split("/")[0].toLowerCase() === c.login.toLowerCase(),
    "Choose a repository owned by the connected account",
    403,
  );
  const meta = await github("/repos/" + repo, c.token);
  requireThat(
    !meta.private,
    "This importer currently supports public repositories only",
  );
  const commit = await github(
    "/repos/" + repo + "/commits/" + encodeURIComponent(meta.default_branch),
    c.token,
  );
  const content = await github(
    "/repos/" + repo + "/contents/punithhub.json?ref=" + commit.sha,
    c.token,
  );
  requireThat(
    content.type === "file" &&
      content.size < 16000 &&
      content.encoding === "base64",
    "Provide a small punithhub.json manifest",
  );
  let value;
  try {
    value = JSON.parse(Buffer.from(content.content, "base64").toString("utf8"));
  } catch {
    throw new Problem("Invalid project manifest");
  }
  const manifest = projectManifest.parse(value);
  await rows(
    "INSERT INTO project_imports(owner_id,repo,sha,manifest) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE sha=VALUES(sha),manifest=VALUES(manifest),status='VALIDATED'",
    [req.session.user_id, repo, commit.sha, JSON.stringify(manifest)],
  );
  res.json({
    ok: true,
    repo,
    sha: commit.sha,
    manifest,
    status: "VALIDATED",
    message:
      "Repository synchronized and manifest validated. Deployment requires an isolated build worker; repository code has not been executed.",
  });
});
