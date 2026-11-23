import { readFile, readdir } from "node:fs/promises";
import { pool, rows } from "../server/db.js";
try {
  await rows(
    "CREATE TABLE IF NOT EXISTS schema_migrations(version VARCHAR(100) PRIMARY KEY,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const file of (await readdir(new URL("../sql/", import.meta.url)))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    if (
      (
        await rows("SELECT version FROM schema_migrations WHERE version=?", [
          file,
        ])
      ).length
    )
      continue;
    const sql = await readFile(
      new URL("../sql/" + file, import.meta.url),
      "utf8",
    );
    for (const statement of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean))
      await rows(statement);
    await rows("INSERT INTO schema_migrations(version) VALUES(?)", [file]);
    console.log("Applied", file);
  }
} finally {
  await pool.end();
}
