// Crypto implementation of AssetProvider: CoinGecko for market data and
// listings, DefiLlama for fundamentals, Binance/Bybit for derivatives.

import type { Liquidity } from "@/lib/types";
import * as cg from "./coingecko";
import { livePrice } from "./binance";
import { getFundamentals } from "./defillama";
import { getDerivatives } from "./derivatives";
import type { AssetProvider, DailyBar } from "./types";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 100);
const positive = (v: number | null | undefined) => (v && v > 0 ? v : null);

/** Exchanges treated as tier-1 (deep books, strict listing standards). CoinGecko ids → display names. */
const TIER1 = new Map([
  ["binance", "Binance"],
  ["gdax", "Coinbase"],
  ["kraken", "Kraken"],
  ["okex", "OKX"],
  ["bybit_spot", "Bybit"],
  ["upbit", "Upbit"],
  ["bitstamp", "Bitstamp"],
  ["bitfinex", "Bitfinex"],
  ["kucoin", "KuCoin"],
  ["crypto_com", "Crypto.com"],
  ["bitget", "Bitget"],
  ["gate", "Gate"],
]);

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };

/** CoinGecko descriptions contain HTML tags and entities; plain text is enough here. */
function plainText(html: string | undefined): string | null {
  const text = html
    ?.replace(/<[^>]+>/g, "")
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? e)
    .replace(/\r\n/g, "\n")
    .trim();
  return text || null;
}

/** Collapses CoinGecko's chart into one bar per UTC day (the last point of each day wins). */
function toDailyBars(chart: cg.CgMarketChart): DailyBar[] {
  const byDate = new Map<string, DailyBar>();
  chart.prices.forEach(([ts, close], i) => {
    if (!Number.isFinite(close) || close <= 0) return;
    const date = new Date(ts).toISOString().slice(0, 10);
    byDate.set(date, {
      date,
      close,
      volume: chart.total_volumes[i]?.[1] ?? 0,
      marketCap: positive(chart.market_caps[i]?.[1]),
    });
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export const cryptoProvider: AssetProvider = {
  assetClass: "crypto",
  benchmarkId: "bitcoin",
  benchmarkLabel: "BTC",

  async search(query) {
    const res = await cg.searchCoins(query);
    return res.coins.slice(0, 8).map((c) => ({
      id: c.id,
      name: c.name,
      symbol: c.symbol.toUpperCase(),
      thumb: c.thumb,
      rank: c.market_cap_rank,
    }));
  },

  async getDetails(id) {
    const c = await cg.getCoin(id);
    const m = c.market_data;
    // CoinGecko details are cached for hours; Binance's live price (free) keeps price-based numbers current.
    const cgPrice = m.current_price.usd ?? 0;
    const live = await livePrice(c.symbol, cgPrice);
    const scale = live && cgPrice > 0 ? live.price / cgPrice : 1;
    const marketCap = positive((m.market_cap.usd ?? 0) * scale);
    const repos = c.links?.repos_url?.github?.filter(Boolean) ?? [];
    const dd = c.developer_data;

    return {
      id: c.id,
      symbol: c.symbol.toUpperCase(),
      name: c.name,
      image: c.image?.large ?? c.image?.small ?? null,
      rank: c.market_cap_rank,
      categories: c.categories.filter((x): x is string => !!x),
      price: live?.price ?? cgPrice,
      priceLive: live !== null,
      marketCap,
      fdv: positive((m.fully_diluted_valuation.usd ?? 0) * scale),
      volume24h: m.total_volume.usd ?? null,
      change: {
        d1: live?.change24h ?? pct(m.price_change_percentage_24h),
        d7: pct(m.price_change_percentage_7d),
        d30: pct(m.price_change_percentage_30d),
        d60: pct(m.price_change_percentage_60d),
        d200: pct(m.price_change_percentage_200d),
        y1: pct(m.price_change_percentage_1y),
      },
      athChange: pct(m.ath_change_percentage.usd),
      supply: {
        circulating: positive(m.circulating_supply),
        total: positive(m.total_supply),
        max: positive(m.max_supply),
      },
      dev:
        repos.length || dd?.commit_count_4_weeks
          ? { commits4w: dd?.commit_count_4_weeks ?? null, stars: dd?.stars ?? null, hasRepo: repos.length > 0 }
          : null,
      about: {
        description: plainText(c.description?.en),
        homepage: c.links?.homepage?.find(Boolean) ?? null,
        whitepaper: c.links?.whitepaper || null,
        twitter: c.links?.twitter_screen_name || null,
        github: repos[0] ?? null,
      },
      sentimentUp: pct(c.sentiment_votes_up_percentage),
      genesisDate: c.genesis_date || null,
      fundamentals: await getFundamentals(c.id, marketCap, c.name),
      homePlatform: c.asset_platform_id || null,
      contracts: Object.fromEntries(Object.entries(c.platforms ?? {}).filter((e): e is [string, string] => !!e[0] && !!e[1])),
    };
  },

  async getDailyBars(id, days) {
    return toDailyBars(await cg.getMarketChart(id, days));
  },

  async getTrendingCategories() {
    return (await cg.getTrending()).categories.map((c) => c.name);
  },

  async getTrendingIds() {
    return (await cg.getTrending()).coins.map((c) => c.item.id);
  },

  async getLiquidity(id): Promise<Liquidity | null> {
    const { tickers } = await cg.getTickers(id);
    const live = tickers.filter((t) => !t.is_anomaly && !t.is_stale);
    if (!live.length) return null;

    // Demo keys get trust_score = null, and small exchanges often report fake
    // volume/depth. So "trusted" = green trust score, or a tier-1 venue when unscored.
    // Depth and venue concentration are measured on trusted markets only.
    const isTrusted = (t: (typeof live)[number]) => t.trust_score === "green" || (t.trust_score === null && TIER1.has(t.market.identifier));
    const venues = new Set(live.map((t) => t.market.identifier));
    const trustedVolume = new Map<string, { name: string; volume: number }>();
    let total = 0;
    let trusted = 0;
    let depth = 0;
    for (const t of live) {
      const vol = t.converted_volume.usd ?? 0;
      total += vol;
      if (!isTrusted(t)) continue;
      trusted += vol;
      depth += (t.cost_to_move_up_usd ?? 0) + (t.cost_to_move_down_usd ?? 0);
      const v = trustedVolume.get(t.market.identifier) ?? { name: TIER1.get(t.market.identifier) ?? t.market.name, volume: 0 };
      v.volume += vol;
      trustedVolume.set(t.market.identifier, v);
    }
    const top = [...trustedVolume.values()].sort((a, b) => b.volume - a.volume)[0];

    return {
      exchanges: venues.size,
      markets: live.length,
      tier1: [...venues].filter((k) => TIER1.has(k)).map((k) => TIER1.get(k) as string),
      depthUsd: depth || null,
      topVenue: top?.name ?? null,
      topVenueShare: top && trusted ? top.volume / trusted : null,
      trustedShare: total ? trusted / total : null,
    };
  },

  getDerivatives,
};
