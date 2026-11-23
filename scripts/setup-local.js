import mysql from "mysql2/promise";
import crypto from "node:crypto";
import { access, writeFile } from "node:fs/promises";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const admin = JSON.parse(input);
input = "";
try {
  await access(".env");
  console.error("Private .env already exists; kept unchanged.");
  process.exit(1);
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
let c;
try {
  c = await mysql.createConnection({
    host: "127.0.0.1",
    user: admin.user,
    password: admin.password,
  });
  admin.password = "";
  const user = "skillswap_" + crypto.randomBytes(4).toString("hex"),
    password = crypto.randomBytes(32).toString("hex");
  await c.query(
    "CREATE DATABASE IF NOT EXISTS punithhub_skillswap CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
  );
  await c.query("CREATE USER ?@'localhost' IDENTIFIED BY ?", [user, password]);
  await c.query(
    "GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES,CREATE VIEW,SHOW VIEW ON punithhub_skillswap.* TO ?@'localhost'",
    [user],
  );
  await writeFile(
    ".env",
    `PORT=8790\nPUBLIC_ORIGIN=http://127.0.0.1:8790\nMYSQL_HOST=127.0.0.1\nMYSQL_DATABASE=punithhub_skillswap\nMYSQL_USER=${user}\nMYSQL_PASSWORD=${password}\nSESSION_SECRET=${crypto.randomBytes(48).toString("hex")}\nOWNER_EMAIL=info.punith@gmail.com\nLOCAL_DEMO=true\nHUB_ORIGIN=http://127.0.0.1:8787\nHUB_BRIDGE_SECRET=${crypto.randomBytes(48).toString("hex")}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    "Separate MySQL database and scoped app user created. Private .env saved. Local demo OTP only; no emails sent.",
  );
} catch (e) {
  console.error("Setup failed:", e.code || "configuration error");
  process.exitCode = 1;
} finally {
  await c?.end();
}
