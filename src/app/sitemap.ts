import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

const PAGES: { path: string; priority: number; changeFrequency: "daily" | "weekly" }[] = [
  { path: "", priority: 1, changeFrequency: "daily" },
  { path: "/narratives", priority: 0.9, changeFrequency: "daily" },
  { path: "/similarity", priority: 0.9, changeFrequency: "weekly" },
  { path: "/winners", priority: 0.8, changeFrequency: "weekly" },
  { path: "/backtest", priority: 0.7, changeFrequency: "weekly" },
  { path: "/analyze", priority: 0.6, changeFrequency: "weekly" },
];

// Well-known coins whose report pages are worth indexing. A fixed list, so building the sitemap costs no CoinGecko calls.
const COINS = [
  "bitcoin", "ethereum", "solana", "binancecoin", "ripple", "cardano", "chainlink", "avalanche-2", "sui", "aptos",
  "near", "polkadot", "uniswap", "aave", "maker", "hyperliquid", "ondo-finance", "zcash", "monero", "arbitrum",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    ...PAGES.map(({ path, priority, changeFrequency }) => ({ url: `${SITE_URL}${path}`, priority, changeFrequency })),
    ...COINS.map((id) => ({ url: `${SITE_URL}/coin/${id}`, priority: 0.5, changeFrequency: "daily" as const })),
  ];
}
