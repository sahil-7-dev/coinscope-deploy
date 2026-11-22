// CoinPaprika: free, keyless, 20,000 calls a month. One call returns prices for
// its top 2,000 coins, so it backs up CoinGecko's market list and fills in
// prices without spending CoinGecko's 10,000-call budget.

import { getJson } from "@/lib/server/http";
import { cachedPersistent, MINUTE } from "@/lib/server/cache";
import { countApiCall } from "@/lib/server/db";

export interface PaprikaTicker {
  id: string;
  name: string;
  symbol: string;
  rank: number;
  quotes: {
    USD: {
      price: number;
      volume_24h: number;
      market_cap: number;
      percent_change_1h: number | null;
      percent_change_24h: number | null;
      percent_change_7d: number | null;
      percent_change_30d: number | null;
      percent_change_1y: number | null;
      percent_from_price_ath: number | null;
    };
  };
}

/** Every coin's price; refreshed at most every 30 minutes (≈1,500 calls a month if used nonstop). */
export const paprikaTickers = () =>
  cachedPersistent("paprika:tickers:v1", 30 * MINUTE, async () => {
    await countApiCall("coinpaprika").catch(() => {});
    return getJson<PaprikaTicker[]>("https://api.coinpaprika.com/v1/tickers", { timeoutMs: 30_000 });
  });

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * CoinPaprika's ticker for a CoinGecko coin. Tickers clash (about 40 of the top
 * 300 share one), so it needs the same symbol and either the same name or, when
 * a recent price is known, a price within 30% of it.
 */
export function matchTicker(list: PaprikaTicker[], coin: { symbol: string; name: string; price?: number | null }): PaprikaTicker | null {
  const sym = coin.symbol.toUpperCase();
  const same = list.filter((t) => t.symbol.toUpperCase() === sym);
  const near = (t: PaprikaTicker) => !coin.price || Math.abs(t.quotes.USD.price / coin.price - 1) < 0.3;
  const named = same.filter((t) => norm(t.name) === norm(coin.name) && near(t));
  if (named.length) return named.sort((a, b) => a.rank - b.rank)[0];
  if (!coin.price) return null;
  return same.filter(near).sort((a, b) => a.rank - b.rank)[0] ?? null;
}
