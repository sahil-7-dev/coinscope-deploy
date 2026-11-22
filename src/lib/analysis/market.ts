// Market pulse: global stats, sentiment, breadth, regime and top performers.

import * as cg from "@/lib/providers/coingecko";
import { getFearGreed } from "@/lib/providers/sentiment";
import { fmtPct } from "@/lib/format";
import type { GlobalStats, MarketCoin, MarketPulse } from "@/lib/types";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 100);

/** Stablecoins and wrapped/staked/bridged derivatives distort a "top performers" list. */
export function isDerivativeOrStable(c: cg.CgMarket): boolean {
  if (/wrapped|staked|bridged|restak|liquid staking|tokenized|\bpeg/i.test(c.name)) return true;
  const sym = c.symbol.toLowerCase();
  if (sym !== "btc" && sym !== "eth" && sym.length <= 8 && /(btc|eth)$/.test(sym)) return true;
  const price = c.current_price ?? 0;
  const d30 = c.price_change_percentage_30d_in_currency ?? 0;
  return /usd|eur/.test(sym) || (Math.abs(price - 1) < 0.03 && Math.abs(d30) < 3);
}

/** Keeps every k-th point (plus the last) so a 168-point hourly sparkline ships as ~n points. */
function downsample(values: number[], n: number): number[] {
  if (values.length <= n) return values;
  const step = (values.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => values[Math.round(i * step)]);
}

/** Small payload for the global stats strip in the header. */
export async function getGlobalStats(): Promise<GlobalStats> {
  const [global, fearGreed, apiUsage] = await Promise.all([cg.getGlobal(), getFearGreed().catch(() => null), cg.usage()]);
  return {
    totalMarketCap: global.data.total_market_cap.usd ?? 0,
    totalVolume: global.data.total_volume.usd ?? 0,
    change24h: pct(global.data.market_cap_change_percentage_24h_usd),
    btcDominance: pct(global.data.market_cap_percentage.btc),
    ethDominance: pct(global.data.market_cap_percentage.eth),
    activeCoins: global.data.active_cryptocurrencies ?? null,
    fearGreed: fearGreed ? { value: fearGreed.value, label: fearGreed.label } : null,
    apiUsage,
  };
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export async function getMarketPulse(): Promise<MarketPulse> {
  const [global, markets, trending, categories, fearGreed] = await Promise.all([
    cg.getGlobal(),
    cg.getMarkets(),
    cg.getTrending().catch(() => null),
    cg.getCategories().catch(() => []),
    getFearGreed().catch(() => null),
  ]);

  const coins: MarketCoin[] = markets
    .filter((c) => c.current_price && c.market_cap && !isDerivativeOrStable(c))
    .map((c) => ({
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      image: c.image,
      rank: c.market_cap_rank,
      price: c.current_price as number,
      marketCap: c.market_cap as number,
      volume: c.total_volume ?? 0,
      turnover: c.market_cap ? (c.total_volume ?? 0) / c.market_cap : null,
      sparkline: downsample(c.sparkline_in_7d?.price ?? [], 42),
      change: {
        h1: pct(c.price_change_percentage_1h_in_currency),
        h24: pct(c.price_change_percentage_24h_in_currency),
        d7: pct(c.price_change_percentage_7d_in_currency),
        d30: pct(c.price_change_percentage_30d_in_currency),
        y1: pct(c.price_change_percentage_1y_in_currency),
      },
    }));

  const btcCoin = coins.find((c) => c.id === "bitcoin");
  const top100 = coins.slice(0, 100);
  const up7d = top100.filter((c) => (c.change.d7 ?? 0) > 0).length / Math.max(1, top100.length);
  const up30d = top100.filter((c) => (c.change.d30 ?? 0) > 0).length / Math.max(1, top100.length);
  const altMedian30 = median(top100.filter((c) => c.id !== "bitcoin" && c.change.d30 !== null).map((c) => c.change.d30 as number));
  const altVsBtc30d = altMedian30 !== null && btcCoin?.change.d30 != null ? altMedian30 - btcCoin.change.d30 : null;

  // Regime: one point for or against from each of sentiment, breadth and BTC trend.
  let score = 0;
  const points: string[] = [];
  if (fearGreed) {
    if (fearGreed.value >= 60) score++;
    if (fearGreed.value <= 40) score--;
    points.push(`Fear & Greed at ${fearGreed.value} (${fearGreed.label}).`);
  }
  if (up30d >= 0.6) score++;
  if (up30d <= 0.4) score--;
  points.push(`${Math.round(up30d * 100)}% of the top 100 coins are up over 30 days (${Math.round(up7d * 100)}% over 7 days).`);
  const btc30 = btcCoin?.change.d30 ?? null;
  if (btc30 !== null) {
    if (btc30 >= 0.05) score++;
    if (btc30 <= -0.05) score--;
    points.push(`BTC is ${fmtPct(btc30)} over 30 days.`);
  }
  if (altVsBtc30d !== null) {
    points.push(
      altVsBtc30d > 0.05
        ? `Alts are outperforming BTC by ${fmtPct(altVsBtc30d)} (median, 30d), so money is rotating into altcoins.`
        : altVsBtc30d < -0.05
          ? `Alts are lagging BTC by ${fmtPct(-altVsBtc30d, { signed: false })} (median, 30d), so BTC is leading.`
          : "Alts are moving roughly in line with BTC.",
    );
  }

  const regime: MarketPulse["regime"] =
    score >= 2
      ? { label: "Risk-on", tone: "good", points }
      : score <= -2
        ? { label: "Risk-off", tone: "bad", points }
        : { label: "Neutral", tone: "neutral", points };

  return {
    global: {
      totalMarketCap: global.data.total_market_cap.usd ?? 0,
      totalVolume: global.data.total_volume.usd ?? 0,
      change24h: pct(global.data.market_cap_change_percentage_24h_usd),
      btcDominance: pct(global.data.market_cap_percentage.btc),
      ethDominance: pct(global.data.market_cap_percentage.eth),
      activeCoins: global.data.active_cryptocurrencies ?? null,
    },
    fearGreed,
    btc: btcCoin ? { price: btcCoin.price, d7: btcCoin.change.d7, d30: btcCoin.change.d30 } : null,
    breadth: { up7d, up30d, sample: top100.length },
    altVsBtc30d,
    regime,
    coins,
    trending: (trending?.coins ?? []).slice(0, 10).map(({ item }) => ({
      id: item.id,
      name: item.name,
      symbol: item.symbol.toUpperCase(),
      thumb: item.thumb,
      rank: item.market_cap_rank,
      change24h: pct(item.data?.price_change_percentage_24h?.usd),
    })),
    hotCategories: categories
      .filter((c) => (c.market_cap ?? 0) >= 100e6 && c.market_cap_change_24h !== null)
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        name: c.name,
        marketCap: c.market_cap as number,
        change24h: (c.market_cap_change_24h as number) / 100,
        top3: c.top_3_coins ?? [],
      })),
    updatedAt: new Date().toISOString(),
  };
}
