// CoinGecko client: API key handling, a sliding-window rate limiter, 429
// retries, call counting and response caching (in memory and on disk, so a
// restart doesn't re-spend calls). Server-only — the key never reaches the browser.
//
// The Demo plan allows 100 calls/min but only 10,000 per month, so the monthly
// budget is what matters: slow-changing data is cached for hours.

import { cached, cachedUntil, MINUTE } from "@/lib/server/cache";
import { matchTicker, paprikaTickers } from "./coinpaprika";
import { apiCallsThisMonth, countApiCall, readHttpCache, writeHttpCache } from "@/lib/server/db";
import { getJson, HttpError, sleep } from "@/lib/server/http";

const KEY = process.env.COINGECKO_API_KEY?.trim() || undefined;
const PRO = process.env.COINGECKO_API_PLAN?.trim().toLowerCase() === "pro";
const BASE = PRO ? "https://pro-api.coingecko.com/api/v3" : "https://api.coingecko.com/api/v3";
const KEY_HEADER = PRO ? "x-cg-pro-api-key" : "x-cg-demo-api-key";
// Demo keys allow 100 calls/min (kept a little under); keyless public access is far lower.
const CALLS_PER_MINUTE = Number(process.env.COINGECKO_CALLS_PER_MINUTE) || (KEY ? 90 : 8);
/** Monthly call budget (Demo plan: 10,000). Override for paid plans. */
export const MONTHLY_LIMIT = Number(process.env.COINGECKO_MONTHLY_LIMIT) || (PRO ? 500_000 : 10_000);
const HOUR = 60 * MINUTE;

/** CoinGecko calls made this calendar month (UTC), as counted by this app. */
export async function usage(): Promise<{ month: string; calls: number; limit: number }> {
  try {
    return { ...(await apiCallsThisMonth("coingecko")), limit: MONTHLY_LIMIT };
  } catch {
    return { month: new Date().toISOString().slice(0, 7), calls: 0, limit: MONTHLY_LIMIT };
  }
}

/** Counting must never break a request. */
async function count(): Promise<void> {
  try {
    await countApiCall("coingecko");
  } catch (err) {
    console.warn("[coingecko] usage count:", err instanceof Error ? err.message : err);
  }
}

async function fromDisk<T>(key: string, ttlMs: number): Promise<{ value: T; savedAt: number } | null> {
  try {
    return await readHttpCache<T>(key, ttlMs);
  } catch {
    return null;
  }
}

async function toDisk(key: string, value: unknown): Promise<void> {
  try {
    await writeHttpCache(key, value);
  } catch (err) {
    console.warn("[coingecko] disk cache:", err instanceof Error ? err.message : err);
  }
}

const g = globalThis as unknown as { __cgCalls?: number[] };
const calls = (g.__cgCalls ??= []);

async function acquireSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (calls.length && now - calls[0] > MINUTE) calls.shift();
    if (calls.length < CALLS_PER_MINUTE) {
      calls.push(now);
      return;
    }
    await sleep(MINUTE - (now - calls[0]) + 100);
  }
}

/** CoinGecko's own error text, e.g. ': Invalid API Key' or a wrong-root-URL hint. */
function upstreamReason(body: string): string {
  try {
    const j = JSON.parse(body);
    const msg = j?.status?.error_message ?? j?.error ?? j?.message;
    return typeof msg === "string" ? `: ${msg}` : "";
  } catch {
    return "";
  }
}

function urlFor(path: string, params: Record<string, string | number | boolean>): string {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
}

async function cg<T>(path: string, params: Record<string, string | number | boolean>, ttlMs: number): Promise<T> {
  const url = urlFor(path, params);
  const headers: Record<string, string> = KEY ? { [KEY_HEADER]: KEY } : {};

  const key = `cg:${url}`;
  return cachedUntil(key, async () => {
    const saved = await fromDisk<T>(key, ttlMs);
    if (saved) return { value: saved.value, expires: saved.savedAt + ttlMs };
    for (let attempt = 0; ; attempt++) {
      await acquireSlot();
      // Every request counts toward the monthly budget, failed ones included.
      await count();
      try {
        const value = await getJson<T>(url, { headers });
        await toDisk(key, value);
        return { value, expires: Date.now() + ttlMs };
      } catch (err) {
        if (err instanceof HttpError && err.status === 429 && attempt < 2) {
          await sleep(20_000);
          continue;
        }
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          throw new HttpError(
            err.status,
            `CoinGecko rejected the request (${err.status}${upstreamReason(err.body)}). Check COINGECKO_API_KEY and COINGECKO_API_PLAN in .env.local, then restart the server.`,
          );
        }
        if (err instanceof HttpError && err.status === 429) {
          throw new HttpError(429, "CoinGecko rate limit reached. Wait a minute and try again.");
        }
        throw err;
      }
    }
  });
}

// ---- Response shapes (only the fields we use) ----

type CurrencyMap = { usd?: number | null };

export interface CgCoin {
  id: string;
  symbol: string;
  name: string;
  categories: (string | null)[];
  image?: { large?: string; small?: string };
  market_cap_rank: number | null;
  genesis_date: string | null;
  sentiment_votes_up_percentage: number | null;
  description?: { en?: string };
  /** Token contract per platform (e.g. ethereum → 0x…); native coins have an empty key. */
  platforms?: Record<string, string | null>;
  /** The chain the token lives on natively (null for a chain's own coin). */
  asset_platform_id?: string | null;
  links?: {
    homepage?: string[];
    whitepaper?: string;
    twitter_screen_name?: string;
    repos_url?: { github?: string[] };
  };
  developer_data?: { commit_count_4_weeks?: number | null; stars?: number | null };
  market_data: {
    current_price: CurrencyMap;
    market_cap: CurrencyMap;
    fully_diluted_valuation: CurrencyMap;
    total_volume: CurrencyMap;
    ath_change_percentage: CurrencyMap;
    price_change_percentage_24h: number | null;
    price_change_percentage_7d: number | null;
    price_change_percentage_30d: number | null;
    price_change_percentage_60d: number | null;
    price_change_percentage_200d: number | null;
    price_change_percentage_1y: number | null;
    circulating_supply: number | null;
    total_supply: number | null;
    max_supply: number | null;
  };
}

export interface CgMarketChart {
  prices: [number, number][];
  market_caps: [number, number][];
  total_volumes: [number, number][];
}

export interface CgMarket {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  price_change_percentage_1h_in_currency?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  sparkline_in_7d?: { price?: number[] };
  price_change_percentage_7d_in_currency?: number | null;
  price_change_percentage_30d_in_currency?: number | null;
  price_change_percentage_1y_in_currency?: number | null;
}

export interface CgGlobal {
  data: {
    active_cryptocurrencies: number;
    total_market_cap: CurrencyMap;
    total_volume: CurrencyMap;
    market_cap_percentage: { btc?: number; eth?: number };
    market_cap_change_percentage_24h_usd: number | null;
  };
}

export interface CgTrending {
  coins: {
    item: {
      id: string;
      name: string;
      symbol: string;
      thumb: string;
      market_cap_rank: number | null;
      data?: { price_change_percentage_24h?: CurrencyMap };
    };
  }[];
  categories: { id: number; name: string }[];
}

export interface CgCategory {
  id: string;
  name: string;
  market_cap: number | null;
  market_cap_change_24h: number | null;
  top_3_coins?: string[];
}

export interface CgTickers {
  tickers: {
    market: { name: string; identifier: string };
    trust_score: "green" | "yellow" | "red" | null;
    converted_volume: { usd?: number };
    cost_to_move_up_usd?: number | null;
    cost_to_move_down_usd?: number | null;
    is_anomaly: boolean;
    is_stale: boolean;
  }[];
}

export interface CgSearch {
  coins: { id: string; name: string; symbol: string; market_cap_rank: number | null; thumb: string }[];
}

// ---- Endpoints ----

export const getCoin = (id: string) =>
  cg<CgCoin>(
    `/coins/${encodeURIComponent(id)}`,
    { localization: false, tickers: false, market_data: true, community_data: false, developer_data: true, sparkline: false },
    // Supply, description, dev activity barely change in a day. The live price comes from Binance where listed.
    12 * HOUR,
  );

export const getMarketChart = (id: string, days: number) =>
  // Daily bars: profiles update or add today's bar with the live price, so a day-old chart is fine.
  cg<CgMarketChart>(`/coins/${encodeURIComponent(id)}/market_chart`, { vs_currency: "usd", days, interval: "daily" }, 24 * HOUR);

const MARKETS: [string, Record<string, string | number | boolean>] = [
  "/coins/markets",
  { vs_currency: "usd", order: "market_cap_desc", per_page: 250, page: 1, price_change_percentage: "1h,24h,7d,30d,1y", sparkline: true },
];
/** Past this share of the monthly budget, the market list comes from CoinPaprika so CoinGecko's calls go to coin details. */
const SAVE_BUDGET_AT = 0.9;
const YEAR = 365 * 24 * HOUR;

/**
 * CoinGecko's last saved top-250 list (ids, names, images, any age) with
 * CoinPaprika's current prices on top. Null without a saved list to start from.
 */
const marketsFromPaprika = () =>
  cached("cg:markets:paprika", 30 * MINUTE, async (): Promise<CgMarket[] | null> => {
    const saved = await fromDisk<CgMarket[]>(`cg:${urlFor(...MARKETS)}`, YEAR);
    if (!saved) return null;
    const tickers = await paprikaTickers();
    if (!tickers) return null;
    return saved.value.map((m) => {
      const t = matchTicker(tickers, { symbol: m.symbol, name: m.name, price: m.current_price })?.quotes.USD;
      return t
        ? {
            ...m,
            current_price: t.price,
            market_cap: t.market_cap || m.market_cap,
            total_volume: t.volume_24h,
            price_change_percentage_1h_in_currency: t.percent_change_1h,
            price_change_percentage_24h_in_currency: t.percent_change_24h,
            price_change_percentage_7d_in_currency: t.percent_change_7d,
            price_change_percentage_30d_in_currency: t.percent_change_30d,
            price_change_percentage_1y_in_currency: t.percent_change_1y,
          }
        : m;
    });
  });

/**
 * Top 250 coins by market cap. CoinGecko normally; when it fails, or past 90%
 * of the monthly budget (and the saved copy is over an hour old), CoinGecko's
 * last list with CoinPaprika's prices (free, 20,000 calls a month).
 */
export async function getMarkets(): Promise<CgMarket[]> {
  const [u, fresh] = await Promise.all([usage(), fromDisk<CgMarket[]>(`cg:${urlFor(...MARKETS)}`, HOUR)]);
  if (u.calls >= u.limit * SAVE_BUDGET_AT && !fresh) {
    const backup = await marketsFromPaprika().catch(() => null);
    if (backup) return backup;
  }
  try {
    return await cg<CgMarket[]>(...MARKETS, HOUR);
  } catch (err) {
    const backup = await marketsFromPaprika().catch(() => null);
    if (backup) {
      console.warn("[coingecko] market list failed; using CoinPaprika prices:", err instanceof Error ? err.message : err);
      return backup;
    }
    throw err;
  }
}

export const getTickers = (id: string) =>
  // Listings and order-book depth change slowly.
  cg<CgTickers>(`/coins/${encodeURIComponent(id)}/tickers`, { depth: true, order: "volume_desc", include_exchange_logo: false }, 7 * 24 * HOUR);

/** Top coins inside one CoinGecko category, with 7d/30d changes. */
export const getCategoryMarkets = (category: string) =>
  cg<CgMarket[]>(
    "/coins/markets",
    { vs_currency: "usd", category, order: "market_cap_desc", per_page: 50, page: 1, price_change_percentage: "24h,7d,30d" },
    // Who belongs to a sector rarely changes; narrative performance itself comes from Binance prices.
    7 * 24 * HOUR,
  );

/** Current USD prices for coins outside the top-250 market list; one call for all of them. */
export const getSimplePrices = (ids: string[]) =>
  cg<Record<string, { usd?: number }>>("/simple/price", { ids: [...ids].sort().join(","), vs_currencies: "usd" }, HOUR);

export const getGlobal = () => cg<CgGlobal>("/global", {}, HOUR);
export const getTrending = () => cg<CgTrending>("/search/trending", {}, 2 * HOUR);
export const getCategories = () => cg<CgCategory[]>("/coins/categories", { order: "market_cap_change_24h_desc" }, 24 * HOUR);
export const searchCoins = (query: string) => cg<CgSearch>("/search", { query: query.toLowerCase() }, 7 * 24 * HOUR);
