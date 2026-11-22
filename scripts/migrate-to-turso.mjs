// Copies the local database (data/coinscope.db) into the Turso database named by
// TURSO_DATABASE_URL / TURSO_AUTH_TOKEN. Run: npm run db:migrate-turso
//
// The price and HTTP caches are skipped (they refill themselves); pass
// --with-cache to copy them too. A table that already has rows in Turso is
// skipped, so running this twice never duplicates or overwrites anything.

import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";

const CACHE_TABLES = new Set(["bars_cache", "http_cache"]);
const BATCH = 100;

const url = process.env.TURSO_DATABASE_URL?.trim();
if (!url) {
  console.error("TURSO_DATABASE_URL is not set. Add it (and TURSO_AUTH_TOKEN) to .env.local.");
  process.exit(1);
}
const withCache = process.argv.includes("--with-cache");
const localPath = process.env.COINSCOPE_DB || path.join(process.cwd(), "data", "coinscope.db");

const local = createClient({ url: pathToFileURL(localPath).href });
const remote = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined });

// Tables and indexes exactly as they are locally (including columns added later).
const { rows: objects } = await local.execute(
  "SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC",
);
for (const o of objects) await remote.execute(String(o.sql).replace(/^CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/i, "CREATE $1 IF NOT EXISTS "));

for (const { name } of objects.filter((o) => o.type === "table")) {
  const table = String(name);
  if (CACHE_TABLES.has(table) && !withCache) {
    console.log(`${table.padEnd(20)} skipped (cache)`);
    continue;
  }
  const existing = Number((await remote.execute(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n);
  if (existing > 0) {
    console.log(`${table.padEnd(20)} skipped (Turso already has ${existing} rows)`);
    continue;
  }
  const { columns, rows } = await local.execute(`SELECT * FROM "${table}"`);
  const insert = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += BATCH) {
    await remote.batch(
      rows.slice(i, i + BATCH).map((r) => ({ sql: insert, args: columns.map((c) => r[c]) })),
      "write",
    );
  }
  console.log(`${table.padEnd(20)} copied ${rows.length} rows`);
}

local.close();
remote.close();
console.log("Done.");
