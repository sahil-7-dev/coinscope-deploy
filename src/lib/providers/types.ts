// The provider interface keeps the analysis engine independent of the data
// source. Crypto uses CoinGecko + DefiLlama + Binance/Bybit today; a stock
// provider can implement the same interface later and reuse the dashboard,
// checklist, similarity engine and scorers.

import type { AssetAbout, AssetChange, Derivatives, Fundamentals, Liquidity, SearchResult } from "@/lib/types";

export interface DailyBar {
  date: string; // YYYY-MM-DD (UTC)
  close: number;
  volume: number;
  marketCap: number | null;
}

export interface AssetDetails {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
  rank: number | null;
  categories: string[];
  price: number;
  /** Price is live from Binance (otherwise it's CoinGecko's, up to a few hours old). */
  priceLive: boolean;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  change: AssetChange;
  athChange: number | null;
  supply: { circulating: number | null; total: number | null; max: number | null };
  dev: { commits4w: number | null; stars: number | null; hasRepo: boolean } | null;
  about: AssetAbout | null;
  sentimentUp: number | null;
  genesisDate: string | null;
  fundamentals: Fundamentals | null;
  /** Token contracts by CoinGecko platform id (ethereum, optimistic-ethereum, …). */
  contracts: Record<string, string>;
  /** The token's home chain (CoinGecko platform id); null for a chain's own coin. */
  homePlatform: string | null;
}

export interface AssetProvider {
  readonly assetClass: "crypto" | "stock";
  /** Asset that relative strength is measured against (BTC for crypto, e.g. SPY for stocks). */
  readonly benchmarkId: string;
  readonly benchmarkLabel: string;
  search(query: string): Promise<SearchResult[]>;
  getDetails(id: string): Promise<AssetDetails>;
  getDailyBars(id: string, days: number): Promise<DailyBar[]>;
  getTrendingCategories(): Promise<string[]>;
  getTrendingIds(): Promise<string[]>;
  getLiquidity(id: string): Promise<Liquidity | null>;
  getDerivatives(symbol: string, spotPrice: number): Promise<Derivatives | null>;
}
