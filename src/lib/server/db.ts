// SQLite store for the reference library, the watchlist and score snapshots.
// Hosted on Turso when TURSO_DATABASE_URL is set (e.g. on Vercel, whose disk is
// read-only), otherwise a local file: data/coinscope.db by default.

import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient, type Client, type ResultSet } from "@libsql/client";
import type { DailyBar } from "@/lib/providers/types";
import type { CoinProfile, CoinResearch, Decision, LibraryEntry, ScorePoint, ThesisEvent, WatchItem } from "@/lib/types";

const REMOTE_URL = process.env.TURSO_DATABASE_URL?.trim() || undefined;
const DB_PATH = process.env.COINSCOPE_DB || path.join(process.cwd(), "data", "coinscope.db");
/** At most one score snapshot per coin per this interval. */
const SNAPSHOT_INTERVAL_MS = 6 * 3600_000;
const HISTORY_POINTS = 120;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS reference_coins (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL, image TEXT,
    note TEXT NOT NULL DEFAULT '', saved_at TEXT NOT NULL, profile TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS watchlist (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, symbol TEXT NOT NULL, image TEXT, added_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, coin_id TEXT NOT NULL, taken_at TEXT NOT NULL,
    price REAL, short REAL, mid REAL, long REAL, risk REAL
  );
  CREATE INDEX IF NOT EXISTS snapshots_coin ON snapshots (coin_id, taken_at);
  CREATE TABLE IF NOT EXISTS bars_cache (key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, bars TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, saved_at TEXT NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS research (coin_id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS api_usage (month TEXT NOT NULL, provider TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (month, provider));
  CREATE TABLE IF NOT EXISTS http_cache (key TEXT PRIMARY KEY, saved_at INTEGER NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS narrative_mentions (date TEXT NOT NULL, sector_id TEXT NOT NULL, mentions INTEGER NOT NULL, PRIMARY KEY (date, sector_id));
  CREATE TABLE IF NOT EXISTS thesis_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, coin_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, detail TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS thesis_events_coin ON thesis_events (coin_id, at);
  CREATE TABLE IF NOT EXISTS benchmark_choice (coin_id TEXT PRIMARY KEY, as_of TEXT NOT NULL, saved_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, coin_id TEXT NOT NULL, symbol TEXT NOT NULL, name TEXT NOT NULL, image TEXT,
    action TEXT NOT NULL, decided_on TEXT NOT NULL, price REAL NOT NULL, btc_price REAL NOT NULL, snapshot TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '', closed_on TEXT, close_price REAL, close_btc_price REAL, created_at TEXT NOT NULL
  );
`;

/** Columns added after a table was first created (CREATE TABLE IF NOT EXISTS won't add them). */
const ADDED_COLUMNS = ["ALTER TABLE snapshots ADD COLUMN verdict TEXT"];

const g = globalThis as unknown as { __coinscopeDb?: Promise<Client>; __coinscopeSchema?: string };

async function open(): Promise<Client> {
  let client: Client;
  if (REMOTE_URL) {
    client = createClient({ url: REMOTE_URL, authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined });
  } else {
    mkdirSync(path.dirname(DB_PATH), { recursive: true });
    client = createClient({ url: pathToFileURL(DB_PATH).href });
    await client.execute("PRAGMA journal_mode = WAL");
  }
  await client.executeMultiple(SCHEMA);
  for (const sql of ADDED_COLUMNS) {
    try {
      await client.execute(sql);
    } catch {
      // Already there.
    }
  }
  return client;
}

function db(): Promise<Client> {
  // The connection outlives hot reloads, so re-apply the (idempotent) schema whenever it changes.
  if (g.__coinscopeDb && g.__coinscopeSchema === SCHEMA) return g.__coinscopeDb;
  g.__coinscopeSchema = SCHEMA;
  const opening = open();
  // A failed open (e.g. Turso unreachable) is retried on the next call instead of being cached.
  opening.catch(() => {
    if (g.__coinscopeDb === opening) g.__coinscopeDb = undefined;
  });
  return (g.__coinscopeDb = opening);
}

type Arg = string | number | bigint | null | undefined;

async function run(sql: string, ...args: Arg[]): Promise<ResultSet> {
  return (await db()).execute({ sql, args: args.map((a) => a ?? null) });
}

async function all<T>(sql: string, ...args: Arg[]): Promise<T[]> {
  return (await run(sql, ...args)).rows as unknown as T[];
}

async function get<T>(sql: string, ...args: Arg[]): Promise<T | undefined> {
  return (await all<T>(sql, ...args))[0];
}

// ---- Reference library ----

interface ReferenceRow {
  id: string;
  name: string;
  symbol: string;
  image: string | null;
  note: string;
  saved_at: string;
  profile: string;
}

function toEntry(r: ReferenceRow, withSeries: boolean): LibraryEntry {
  const profile = JSON.parse(r.profile) as CoinProfile;
  return {
    id: r.id,
    name: r.name,
    symbol: r.symbol,
    image: r.image,
    note: r.note,
    savedAt: r.saved_at,
    profile: withSeries ? profile : { ...profile, series: [] },
  };
}

export async function listReferences(): Promise<LibraryEntry[]> {
  const rows = await all<ReferenceRow>("SELECT * FROM reference_coins ORDER BY saved_at DESC");
  return rows.map((r) => toEntry(r, false));
}

export async function getReference(id: string): Promise<LibraryEntry | null> {
  const row = await get<ReferenceRow>("SELECT * FROM reference_coins WHERE id = ?", id);
  return row ? toEntry(row, true) : null;
}

export async function saveReference(profile: CoinProfile, note: string): Promise<LibraryEntry> {
  const savedAt = new Date().toISOString();
  await run(
    `INSERT INTO reference_coins (id, name, symbol, image, note, saved_at, profile) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, symbol = excluded.symbol, image = excluded.image,
       note = excluded.note, saved_at = excluded.saved_at, profile = excluded.profile`,
    profile.id,
    profile.name,
    profile.symbol,
    profile.image,
    note,
    savedAt,
    JSON.stringify(profile),
  );
  return { id: profile.id, name: profile.name, symbol: profile.symbol, image: profile.image, note, savedAt, profile };
}

export async function updateReferenceNote(id: string, note: string): Promise<void> {
  await run("UPDATE reference_coins SET note = ? WHERE id = ?", note, id);
}

export async function deleteReference(id: string): Promise<void> {
  await run("DELETE FROM reference_coins WHERE id = ?", id);
}

// ---- Watchlist & score history ----

export async function recordSnapshot(p: CoinProfile, verdict: string | null, minIntervalMs = SNAPSHOT_INTERVAL_MS): Promise<void> {
  const last = await get<{ taken_at: string }>("SELECT taken_at FROM snapshots WHERE coin_id = ? ORDER BY taken_at DESC LIMIT 1", p.id);
  if (last && Date.now() - Date.parse(last.taken_at) < minIntervalMs) return;
  const s = p.scores;
  await run(
    "INSERT INTO snapshots (coin_id, taken_at, price, short, mid, long, risk, verdict) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    p.id,
    new Date().toISOString(),
    p.price,
    s.short.score,
    s.mid.score,
    s.long.score,
    s.risk.score,
    verdict,
  );
}

export async function scoreHistory(coinId: string): Promise<ScorePoint[]> {
  const rows = await all<{
    taken_at: string;
    price: number;
    short: number | null;
    mid: number | null;
    long: number | null;
    risk: number | null;
    verdict: string | null;
  }>("SELECT taken_at, price, short, mid, long, risk, verdict FROM snapshots WHERE coin_id = ? ORDER BY taken_at DESC LIMIT ?", coinId, HISTORY_POINTS);
  return rows
    .reverse()
    .map((r) => ({ takenAt: r.taken_at, price: r.price, short: r.short, mid: r.mid, long: r.long, risk: r.risk, verdict: r.verdict }));
}

export async function listWatchlist(): Promise<WatchItem[]> {
  const rows = await all<{
    id: string;
    name: string;
    symbol: string;
    image: string | null;
    added_at: string;
  }>("SELECT * FROM watchlist ORDER BY added_at");
  return Promise.all(
    rows.map(async (r) => ({ id: r.id, name: r.name, symbol: r.symbol, image: r.image, addedAt: r.added_at, history: await scoreHistory(r.id) })),
  );
}

export async function addToWatchlist(coin: { id: string; name: string; symbol: string; image?: string | null }): Promise<void> {
  await run(
    "INSERT OR IGNORE INTO watchlist (id, name, symbol, image, added_at) VALUES (?, ?, ?, ?, ?)",
    coin.id,
    coin.name,
    coin.symbol,
    coin.image ?? null,
    new Date().toISOString(),
  );
}

export async function removeFromWatchlist(id: string): Promise<void> {
  await run("DELETE FROM watchlist WHERE id = ?", id);
}

// ---- Long price history cache ----

type CompactBar = [string, number, number, number | null];

/** Cached daily bars, or null when missing or older than maxAgeMs. */
export async function getCachedBars(key: string, maxAgeMs: number): Promise<DailyBar[] | null> {
  const row = await get<{ fetched_at: string; bars: string }>("SELECT fetched_at, bars FROM bars_cache WHERE key = ?", key);
  if (!row || Date.now() - Date.parse(row.fetched_at) > maxAgeMs) return null;
  return (JSON.parse(row.bars) as CompactBar[]).map(([date, close, volume, marketCap]) => ({ date, close, volume, marketCap }));
}

export async function saveCachedBars(key: string, bars: DailyBar[]): Promise<void> {
  const compact: CompactBar[] = bars.map((b) => [b.date, b.close, Math.round(b.volume), b.marketCap]);
  await run(
    "INSERT INTO bars_cache (key, fetched_at, bars) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at, bars = excluded.bars",
    key,
    new Date().toISOString(),
    JSON.stringify(compact),
  );
}

// ---- Saved results (latest narratives, latest backtest) ----

export async function getKv<T>(key: string): Promise<{ savedAt: string; value: T } | null> {
  const row = await get<{ saved_at: string; value: string }>("SELECT saved_at, value FROM kv WHERE key = ?", key);
  return row ? { savedAt: row.saved_at, value: JSON.parse(row.value) as T } : null;
}

export async function setKv(key: string, value: unknown): Promise<void> {
  await run(
    "INSERT INTO kv (key, saved_at, value) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET saved_at = excluded.saved_at, value = excluded.value",
    key,
    new Date().toISOString(),
    JSON.stringify(value),
  );
}

// ---- Your research (ratings and notes per coin) ----

export async function getResearch(ids: string[]): Promise<Record<string, CoinResearch>> {
  if (!ids.length) return {};
  const rows = await all<{ coin_id: string; updated_at: string; data: string }>(
    `SELECT coin_id, updated_at, data FROM research WHERE coin_id IN (${ids.map(() => "?").join(",")})`,
    ...ids,
  );
  return Object.fromEntries(
    rows.map((r) => {
      const data = JSON.parse(r.data) as CoinResearch & { notes: { speciality?: string } };
      // Older saves had one "speciality" note (it maps onto "what makes it hard to copy") and no thesis or evidence.
      const { speciality, ...notes } = data.notes;
      return [
        r.coin_id,
        {
          ...data,
          notes: { ...notes, unique: notes.unique || speciality || "" },
          thesis: data.thesis ?? { stance: null, summary: "", assumptions: [], reviewOn: null },
          evidence: data.evidence ?? {},
          updatedAt: r.updated_at,
        },
      ];
    }),
  );
}

export async function saveResearch(id: string, research: CoinResearch): Promise<CoinResearch> {
  const updatedAt = new Date().toISOString();
  await run(
    "INSERT INTO research (coin_id, updated_at, data) VALUES (?, ?, ?) ON CONFLICT(coin_id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data",
    id,
    updatedAt,
    JSON.stringify({ ratings: research.ratings, notes: research.notes, thesis: research.thesis, evidence: research.evidence }),
  );
  return { ...research, updatedAt };
}

// ---- API usage (calls per calendar month, UTC) ----

const thisMonth = () => new Date().toISOString().slice(0, 7);

export async function countApiCall(provider: string): Promise<void> {
  await run(
    "INSERT INTO api_usage (month, provider, calls) VALUES (?, ?, 1) ON CONFLICT(month, provider) DO UPDATE SET calls = calls + 1",
    thisMonth(),
    provider,
  );
}

export async function apiCallsThisMonth(provider: string): Promise<{ month: string; calls: number }> {
  const month = thisMonth();
  const row = await get<{ calls: number }>("SELECT calls FROM api_usage WHERE month = ? AND provider = ?", month, provider);
  return { month, calls: row?.calls ?? 0 };
}

// ---- Persistent HTTP cache (survives server restarts) ----

/** A cached response and when it was saved (ms), or null when missing or older than maxAgeMs. */
export async function readHttpCache<T>(key: string, maxAgeMs: number): Promise<{ value: T; savedAt: number } | null> {
  const row = await get<{ saved_at: number; value: string }>("SELECT saved_at, value FROM http_cache WHERE key = ?", key);
  if (!row || Date.now() - row.saved_at > maxAgeMs) return null;
  return { value: JSON.parse(row.value) as T, savedAt: row.saved_at };
}

export async function writeHttpCache(key: string, value: unknown): Promise<void> {
  await run(
    "INSERT INTO http_cache (key, saved_at, value) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET saved_at = excluded.saved_at, value = excluded.value",
    key,
    Date.now(),
    JSON.stringify(value),
  );
}

// ---- Narrative headline mentions (one count per sector per day) ----

export async function recordMentions(sectorId: string, mentions: number): Promise<void> {
  await run(
    "INSERT INTO narrative_mentions (date, sector_id, mentions) VALUES (?, ?, ?) ON CONFLICT(date, sector_id) DO UPDATE SET mentions = MAX(mentions, excluded.mentions)",
    new Date().toISOString().slice(0, 10),
    sectorId,
    mentions,
  );
}

/** Mentions over the last 7 saved days vs the 7 before; null until 14 days are saved. */
export async function mentionTrend(sectorId: string): Promise<{ last7: number; prev7: number } | null> {
  const rows = await all<{ mentions: number }>("SELECT mentions FROM narrative_mentions WHERE sector_id = ? ORDER BY date DESC LIMIT 14", sectorId);
  if (rows.length < 14) return null;
  const sum = (xs: { mentions: number }[]) => xs.reduce((a, r) => a + r.mentions, 0);
  return { last7: sum(rows.slice(0, 7)), prev7: sum(rows.slice(7)) };
}

// ---- Thesis history ----

export async function recordThesisEvent(coinId: string, kind: ThesisEvent["kind"], detail: string, ref: string | null = null): Promise<void> {
  await run("INSERT INTO thesis_events (coin_id, at, kind, ref, detail) VALUES (?, ?, ?, ?, ?)", coinId, new Date().toISOString(), kind, ref, detail);
}

export async function listThesisEvents(coinId: string, limit = 50): Promise<ThesisEvent[]> {
  const rows = await all<ThesisEvent>("SELECT at, kind, detail, ref FROM thesis_events WHERE coin_id = ? ORDER BY at DESC, id DESC LIMIT ?", coinId, limit);
  return rows.map((r) => ({ at: r.at, kind: r.kind, detail: r.detail, ref: r.ref }));
}

/** The last recorded check result for one assumption ("holds" / "broken"), or null if it was never checked. */
export async function lastAssumptionStatus(coinId: string, assumptionId: string): Promise<"holds" | "broken" | null> {
  const row = await get<{ kind: string }>(
    "SELECT kind FROM thesis_events WHERE coin_id = ? AND ref = ? AND kind IN ('assumption-broken', 'assumption-holds') ORDER BY at DESC, id DESC LIMIT 1",
    coinId,
    assumptionId,
  );
  return row ? (row.kind === "assumption-broken" ? "broken" : "holds") : null;
}

// ---- Benchmark choices: which run (or date) each winner is compared as of ----

export async function getBenchmarkChoices(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await all<{ coin_id: string; as_of: string }>(
    `SELECT coin_id, as_of FROM benchmark_choice WHERE coin_id IN (${ids.map(() => "?").join(",")})`,
    ...ids,
  );
  return Object.fromEntries(rows.map((r) => [r.coin_id, r.as_of]));
}

/** Saves the date a benchmark is compared as of; null goes back to its default (biggest recent run). */
export async function saveBenchmarkChoice(coinId: string, asOf: string | null): Promise<void> {
  if (asOf === null) await run("DELETE FROM benchmark_choice WHERE coin_id = ?", coinId);
  else
    await run(
      "INSERT INTO benchmark_choice (coin_id, as_of, saved_at) VALUES (?, ?, ?) ON CONFLICT(coin_id) DO UPDATE SET as_of = excluded.as_of, saved_at = excluded.saved_at",
      coinId,
      asOf,
      new Date().toISOString(),
    );
}

// ---- Decision journal ----

/** What the app said when the decision was made, kept as JSON so it can grow. */
export type DecisionSnapshot = Pick<Decision, "verdict" | "verdictLabel" | "score" | "confidence" | "sector" | "stage" | "attention" | "thesis">;

interface DecisionRow {
  id: number;
  coin_id: string;
  symbol: string;
  name: string;
  image: string | null;
  action: Decision["action"];
  decided_on: string;
  price: number;
  btc_price: number;
  snapshot: string;
  note: string;
  closed_on: string | null;
  close_price: number | null;
  close_btc_price: number | null;
  created_at: string;
}

function toDecision(r: DecisionRow): Decision {
  return {
    id: r.id,
    coinId: r.coin_id,
    symbol: r.symbol,
    name: r.name,
    image: r.image,
    action: r.action,
    decidedOn: r.decided_on,
    price: r.price,
    btcPrice: r.btc_price,
    ...(JSON.parse(r.snapshot) as DecisionSnapshot),
    note: r.note,
    closedOn: r.closed_on,
    closePrice: r.close_price,
    closeBtcPrice: r.close_btc_price,
    createdAt: r.created_at,
  };
}

export async function listDecisions(): Promise<Decision[]> {
  return (await all<DecisionRow>("SELECT * FROM decisions ORDER BY decided_on DESC, id DESC")).map(toDecision);
}

export async function getDecision(id: number): Promise<Decision | null> {
  const row = await get<DecisionRow>("SELECT * FROM decisions WHERE id = ?", id);
  return row ? toDecision(row) : null;
}

export async function addDecision(
  d: Omit<Decision, "id" | "createdAt" | "closedOn" | "closePrice" | "closeBtcPrice" | keyof DecisionSnapshot>,
  snapshot: DecisionSnapshot,
): Promise<Decision> {
  const { lastInsertRowid } = await run(
    "INSERT INTO decisions (coin_id, symbol, name, image, action, decided_on, price, btc_price, snapshot, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    d.coinId,
    d.symbol,
    d.name,
    d.image,
    d.action,
    d.decidedOn,
    d.price,
    d.btcPrice,
    JSON.stringify(snapshot),
    d.note,
    new Date().toISOString(),
  );
  return (await getDecision(Number(lastInsertRowid))) as Decision;
}

/** Marks a buy as sold (or reopens it with nulls). */
export async function closeDecision(id: number, close: { on: string; price: number; btcPrice: number } | null): Promise<void> {
  await run("UPDATE decisions SET closed_on = ?, close_price = ?, close_btc_price = ? WHERE id = ?", close?.on ?? null, close?.price ?? null, close?.btcPrice ?? null, id);
}

export async function deleteDecision(id: number): Promise<void> {
  await run("DELETE FROM decisions WHERE id = ?", id);
}
