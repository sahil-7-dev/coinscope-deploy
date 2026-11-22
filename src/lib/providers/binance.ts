// Binance spot: multi-year daily history for backtests and narrative indexes.
// Free and keyless. Delisted pairs ("BREAK") keep their history up to the
// delisting date, so backtests can include coins that died (less survivorship bias).

import { cached, MINUTE } from "@/lib/server/cache";
import { getJson, HttpError, sleep } from "@/lib/server/http";
import type { DailyBar } from "./types";

const BASE = "https://api.binance.com/api/v3";
const DAY = 86_400_000;

export interface SpotPair {
  symbol: string;
  base: string;
  status: "TRADING" | "BREAK";
}

/** Stablecoins, fiat, gold and wrapped assets: not investable "coins" for this purpose. */
const NOT_COINS = new Set([
  "USDC", "FDUSD", "TUSD", "BUSD", "USDP", "DAI", "PAX", "USDS", "USDSB", "USDE", "PYUSD", "RLUSD", "XUSD", "BFUSD", "USD1", "AEUR", "EURI",
  "EUR", "GBP", "AUD", "TRY", "BRL", "PAXG", "XAUT", "WBTC", "WBETH", "BETH", "BKRW", "BIDR", "IDRT", "NGN", "RUB", "UAH", "ZAR", "SUSD", "USTC", "UST",
]);

interface ExchangeInfo {
  symbols: { symbol: string; status: string; baseAsset: string; quoteAsset: string }[];
}

/** USDT spot pairs keyed by base asset (e.g. "SOL"), trading and delisted. Leveraged tokens excluded. */
export const spotUsdtPairs = () =>
  cached("bn:pairs", 24 * 60 * MINUTE, async () => {
    const info = await getJson<ExchangeInfo>(`${BASE}/exchangeInfo?showPermissionSets=false`, { timeoutMs: 60_000 });
    const usdt = info.symbols.filter((s) => s.quoteAsset === "USDT" && (s.status === "TRADING" || s.status === "BREAK"));
    const bases = new Set(usdt.map((s) => s.baseAsset));
    // BTCUP / BTCDOWN / ETHBULL style leveraged tokens (but not JUP, SUP…: the prefix must itself be listed).
    const leveraged = (b: string) => /(BULL|BEAR|DOWN)$/.test(b) || (b.endsWith("UP") && b.length > 4 && bases.has(b.slice(0, -2)));

    const pairs = new Map<string, SpotPair>();
    for (const s of usdt) {
      if (NOT_COINS.has(s.baseAsset) || leveraged(s.baseAsset)) continue;
      const prev = pairs.get(s.baseAsset);
      if (prev?.status === "TRADING") continue;
      pairs.set(s.baseAsset, { symbol: s.symbol, base: s.baseAsset, status: s.status as SpotPair["status"] });
    }
    return pairs;
  });

interface MiniTicker {
  symbol: string;
  openPrice: string;
  lastPrice: string;
  quoteVolume: string;
}

/** Last price, 24h change and 24h quote volume for every pair: one free call, refreshed each minute. */
const liveTickers = () =>
  cached("bn:tickers", MINUTE, async () => {
    const rows = await getJson<MiniTicker[]>(`${BASE}/ticker/24hr?type=MINI`, { timeoutMs: 30_000 });
    return new Map(
      rows.map((r) => {
        const last = Number(r.lastPrice);
        const open = Number(r.openPrice);
        return [r.symbol, { price: last, change24h: open > 0 ? last / open - 1 : null, quoteVolume: Number(r.quoteVolume) || 0 }];
      }),
    );
  });

/** 24h quote volume (USDT) per trading symbol, for ranking the universe by liquidity. */
export const quoteVolumes24h = async () => new Map([...(await liveTickers())].map(([sym, t]) => [sym, t.quoteVolume]));

/**
 * Live USDT price for a ticker, if Binance lists it and its price is close to
 * `reference` (a recent price from another source): two coins can share a ticker.
 */
export async function livePrice(symbol: string, reference: number): Promise<{ price: number; change24h: number | null } | null> {
  const t = (await liveTickers().catch(() => null))?.get(`${symbol.toUpperCase()}USDT`);
  if (!t || !(t.price > 0) || !(reference > 0)) return null;
  return Math.abs(t.price / reference - 1) < 0.5 ? { price: t.price, change24h: t.change24h } : null;
}

// Binance allows 6,000 request weight per minute; klines cost 2. A few requests
// in flight keeps us far below that while still loading hundreds of coins quickly.
const MAX_INFLIGHT = 5;
const g = globalThis as unknown as { __bnInflight?: number };

async function limited<T>(fn: () => Promise<T>): Promise<T> {
  while ((g.__bnInflight ?? 0) >= MAX_INFLIGHT) await sleep(50);
  g.__bnInflight = (g.__bnInflight ?? 0) + 1;
  try {
    return await fn();
  } finally {
    g.__bnInflight = (g.__bnInflight ?? 1) - 1;
  }
}

type Kline = [number, string, string, string, string, string, number, string, ...unknown[]];

async function klinePage(symbol: string, startMs: number): Promise<Kline[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await limited(() =>
        getJson<Kline[]>(`${BASE}/klines?symbol=${symbol}&interval=1d&startTime=${startMs}&limit=1000`, { timeoutMs: 30_000 }),
      );
    } catch (err) {
      // 429 = slow down, 418 = temporary ban for ignoring 429s.
      if (err instanceof HttpError && (err.status === 429 || err.status === 418) && attempt < 3) {
        await sleep(15_000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

/** Daily bars (close and USDT quote volume) from startMs to today. Market cap isn't available from Binance. */
export async function getDailyKlines(symbol: string, startMs: number): Promise<DailyBar[]> {
  const bars: DailyBar[] = [];
  let from = startMs;
  for (;;) {
    const page = await klinePage(symbol, from);
    for (const k of page) {
      const close = Number(k[4]);
      if (close > 0) bars.push({ date: new Date(k[0]).toISOString().slice(0, 10), close, volume: Number(k[7]) || 0, marketCap: null });
    }
    if (page.length < 1000) break;
    from = page[page.length - 1][0] + DAY;
  }
  return bars;
}
