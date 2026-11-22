// Minimal, explicit test data. Only the fields the engines read are filled in.

export { faInputsWith } from "@/lib/analysis/fundamentals";
import type { FundamentalSnapshot } from "@/lib/analysis/similarity";
import type { CoinNarrative, CoinProfile, Fundamentals, PricePoint, RedFlag } from "@/lib/types";

/** A solid fee-earning protocol: growing usage, holders paid, cheap, mature. */
export const goodFundamentals: Fundamentals = {
  source: "DefiLlama",
  slug: "test",
  kind: "protocol",
  name: "Test",
  tvl: 1e9,
  tvlChange7d: 0.05,
  mcapToTvl: 0.8,
  fees30d: 5e6,
  feesPrev30d: 4e6,
  fees90d: 14e6,
  feesPrev90d: 10e6,
  revenue30d: 2e6,
  revenue90d: 5e6,
  revenuePrev90d: 4e6,
  feesAnnualized: 6e7,
  revenueAnnualized: 2.4e7,
  priceToFees: 12,
  priceToSales: 30,
  feesGrowth30d: 0.25,
  feesGrowth90d: 0.4,
  revenueGrowth90d: 0.25,
  holdersRevenue30d: 1.5e6,
  holderShare: 0.3,
  revenueShare: 0.4,
  category: "Lending",
  categoryShare: 0.2,
  categoryRank: 2,
  categoryPeers: 40,
  audits: 3,
  hacks: { count: 0, lostUsd: 0, last: null },
  listedAt: "2021-01-01",
  stablecoins: null,
  launches: null,
  peers: [],
};

export const narrative = (stage: CoinNarrative["stage"], attention: CoinNarrative["attention"] = "Unnoticed"): CoinNarrative => ({
  sector: "Test Sector",
  stage,
  attention,
  phase: "Running",
  strength: 80,
  rel30: 0.05,
  rel7: 0.01,
  since: "2026-11-01",
});

interface ProfileOptions {
  fundamentals?: Fundamentals | null;
  narrative?: CoinNarrative | null;
  risk?: number;
  redFlags?: RedFlag[];
}

/** Just enough of a CoinProfile for the scorecard and verdict. */
export function profileWith(o: ProfileOptions = {}): CoinProfile {
  return {
    id: "test-coin",
    symbol: "TST",
    name: "Test Coin",
    categories: ["Test Sector"],
    marketCap: 5e8,
    fundamentals: o.fundamentals === undefined ? goodFundamentals : o.fundamentals,
    tokenomics: { circulatingRatio: 0.9, fdvToMcap: 1.1, inflationAnnual: 0.02 },
    supply: { circulating: 9e8, total: 1e9, max: 1e9, circulatingRatio: 0.9 },
    dev: { commits4w: 60, stars: 500, hasRepo: true },
    devActivity: { repo: "test/test", commits12w: 200, commitsPrev12w: 150, activeWeeks12: 12, contributors: 80 },
    governance: { space: "test.eth", proposals90d: 6, proposalsPrev90d: 5, avgVotes: 100, lastProposal: "2026-11-01" },
    liquidity: { exchanges: 20, markets: 60, tier1: ["Binance", "Coinbase", "OKX", "Kraken"], depthUsd: 5e6, topVenue: "Binance", topVenueShare: 0.4, trustedShare: 0.8 },
    ageDays: 1500,
    technicals: { return90d: 0.1 },
    narrative: o.narrative === undefined ? narrative("Accelerating") : o.narrative,
    narrativeLoaded: true,
    redFlags: o.redFlags ?? [],
    scores: { risk: { score: o.risk ?? 30, coverage: 1, label: "Moderate", tone: "neutral", factors: [] } },
  } as unknown as CoinProfile;
}

export function snapshotWith(overrides: Partial<FundamentalSnapshot> = {}): FundamentalSnapshot {
  return {
    id: "ref",
    name: "Reference",
    symbol: "REF",
    asOf: null,
    hasFees: true,
    fees30d: 5e6,
    feesGrowth30d: 0.2,
    feesGrowth90d: 0.4,
    revenueGrowth90d: 0.3,
    tvl: 1e9,
    commits4w: 50,
    holderShare: 0.3,
    revenueShare: 0.4,
    priceToFees: 12,
    priceToSales: 30,
    mcapToTvl: 0.8,
    circulatingRatio: 0.8,
    inflation: 0.03,
    fdvToMcap: 1.2,
    marketCap: 5e8,
    ageDays: 1500,
    tier1: 4,
    categories: ["Lending/Borrowing Protocols"],
    narrativeSector: "DeFi",
    narrativeStage: "Accelerating",
    ...overrides,
  };
}

/** Daily closes from a list of prices, starting 2026-01-01. */
export function seriesOf(prices: number[]): PricePoint[] {
  return prices.map((price, i) => ({
    date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
    price,
    volume: 1e6,
    marketCap: price * 1e6,
  }));
}
