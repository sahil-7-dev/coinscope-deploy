// Long daily price history (since 2021) per coin, stored in SQLite so a
// several-hundred-coin backtest or narrative index downloads each coin at most
// once a day. Delisted coins never change, so they're kept for a month.

import { getDailyKlines, spotUsdtPairs, type SpotPair } from "@/lib/providers/binance";
import type { DailyBar } from "@/lib/providers/types";
import { getCachedBars, saveCachedBars } from "./db";

export const HISTORY_START = Date.UTC(2021, 0, 1);
const HOUR = 3600_000;
const FRESH_MS = 20 * HOUR;
const DELISTED_FRESH_MS = 30 * 24 * HOUR;

const g = globalThis as unknown as { __longInflight?: Map<string, Promise<DailyBar[]>> };
const inflight = (g.__longInflight ??= new Map());

export async function pairBars(pair: SpotPair): Promise<DailyBar[]> {
  const key = `bn:${pair.symbol}`;
  const pending = inflight.get(key);
  if (pending) return pending;
  // The cache read sits inside the in-flight promise, so concurrent callers share one read and at most one download.
  const p = (async () => {
    const hit = await getCachedBars(key, pair.status === "BREAK" ? DELISTED_FRESH_MS : FRESH_MS);
    if (hit) return hit;
    const bars = await getDailyKlines(pair.symbol, HISTORY_START);
    await saveCachedBars(key, bars);
    return bars;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Long history for a ticker symbol ("SOL"), or null when Binance has no USDT pair for it. */
export async function longBars(symbol: string): Promise<DailyBar[] | null> {
  const pair = (await spotUsdtPairs()).get(symbol.toUpperCase());
  return pair ? pairBars(pair) : null;
}
