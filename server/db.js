import "dotenv/config";
import mysql from "mysql2/promise";
export const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || "skillswap_app",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "skillswap",
  connectionLimit: 8,
  timezone: "Z",
  dateStrings: true,
  decimalNumbers: true,
  multipleStatements: false,
  ...(process.env.MYSQL_SSL === 'true' ? {ssl: {
    rejectUnauthorized: true,
    ...(process.env.MYSQL_SSL_CA ? {ca: process.env.MYSQL_SSL_CA.replace(/\\n/g, '\n')} : {})
  }} : {}),
});
export const rows = async (sql, params = [], db = pool) =>
  (await db.execute(sql, params))[0];
export class Problem extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
export function requireThat(condition, message, status = 400) {
  if (!condition) throw new Problem(message, status);
}
export async function transaction(fn) {
  const c = await pool.getConnection();
  try {
    await c.query("SET time_zone = '+00:00'");
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export async function lockUsers(c, ids) {
  for (const id of [...new Set(ids.map(Number))].sort((a, b) => a - b)) {
    const [u] = await rows(
      "SELECT id,active FROM users WHERE id=? FOR UPDATE",
      [id],
      c,
    );
    requireThat(u, "Account unavailable", 404);
  }
}
export const utc = (value) =>
  new Date(value).toISOString().slice(0, 19).replace("T", " ");
export const fromDb = (value) =>
  new Date(String(value).replace(" ", "T") + "Z");
export async function audit(c, actor, action, id, details = {}) {
  await rows(
    "INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)",
    [actor, action, "session", id, JSON.stringify(details)],
    c,
  );
}
