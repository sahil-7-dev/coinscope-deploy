// Fundamental scorecard: eight categories, each scored 0–100 from free data
// (DefiLlama, CoinGecko, exchanges) or from the user's own research ratings
// where only judgment works (use case, moat, team). No technical analysis:
// price is used only as valuation context ("did usage grow faster than price?").
// Pure and client-safe; the backtest replays the data parts on past days.

import type { CoinProfile, CoinResearch, NarrativeStage, Tone } from "@/lib/types";
import { fmtNum, fmtPct, fmtUsd, fmtX } from "@/lib/format";
import { feesExpected } from "./categories";
import { curve, logCurve } from "./curves";
import type { ProfileCore } from "./drivers";

export type CategoryKey = "useCase" | "narrative" | "adoption" | "valueCapture" | "tokenomics" | "moat" | "execution" | "valuation";

export const CATEGORIES: { key: CategoryKey; label: string; weight: number; why: string }[] = [
  { key: "useCase", label: "Use case & problem", weight: 15, why: "Does it solve a real problem that needs a blockchain and its own token? Your judgment." },
  { key: "narrative", label: "Narrative strength & timing", weight: 15, why: "Is its narrative early, accelerating, mainstream or crowded? Early beats crowded." },
  { key: "adoption", label: "Adoption & growth", weight: 15, why: "Is usage that people pay for growing?" },
  { key: "valueCapture", label: "Token value capture", weight: 15, why: "Does the token get a share of that usage (buybacks, burns, staking payouts)?" },
  { key: "tokenomics", label: "Tokenomics & supply pressure", weight: 10, why: "How much new supply is coming that dilutes holders?" },
  { key: "moat", label: "Technology & competitive moat", weight: 10, why: "Its share of its category's fees, plus your view of how defensible it is." },
  { key: "execution", label: "Team, execution & ecosystem", weight: 10, why: "Evidence the team ships and the product survives: commits, age, audits, hacks, listings." },
  { key: "valuation", label: "Valuation vs fundamentals", weight: 10, why: "Is it cheap for the usage it has, and did usage grow faster than price?" },
];

/** Plain numbers the scorecard reads, so past days can be scored the same way. */
export interface FaInputs {
  hasFees: boolean;
  /** False for business models fees don't measure (privacy, payments, storage, DePIN): no fees there is unknown, not a weakness. */
  feesExpected: boolean;
  feesGrowth30d: number | null;
  feesGrowth90d: number | null;
  feesAnnualized: number | null;
  tvlChange7d: number | null;
  holderShare: number | null;
  revenueShare: number | null;
  holdersRevenueAnnualized: number | null;
  circulatingRatio: number | null;
  inflation: number | null;
  fdvToMcap: number | null;
  /** Cliff unlocks scheduled in the next 90 days, as a share of circulating supply (AlphaGrowth; null when unknown). */
  unlocks90: number | null;
  category: string | null;
  categoryShare: number | null;
  categoryRank: number | null;
  categoryPeers: number | null;
  commits4w: number | null;
  /** GitHub: commits on the main repo over 12 weeks, and the change vs the 12 weeks before. */
  devCommits12w: number | null;
  devTrend: number | null;
  contributors: number | null;
  /** Snapshot proposals over the last 90 days. */
  governance90d: number | null;
  /** Chains only: stablecoins on the chain, 30-day change, and protocols launched there in 90 days. */
  stablecoinChange30d: number | null;
  chainLaunches90d: number | null;
  ageDays: number | null;
  audits: number | null;
  /** null = unknown; count 0 = no hacks on record. */
  hacks: { count: number; daysSinceLast: number | null } | null;
  tier1: number | null;
  priceToFees: number | null;
  priceToSales: number | null;
  mcapToTvl: number | null;
  /** (1 + 90d fee growth) ÷ (1 + 90d price change) − 1. Positive = usage grew faster than price. */
  usageVsPrice: number | null;
  narrativeLoaded: boolean;
  narrative: { sector: string; stage: NarrativeStage; strength: number } | null;
  ratings: CoinResearch["ratings"] | null;
}

export interface ScoreMetric {
  label: string;
  display: string;
  score: number | null;
  /** Fallback scores ("no fee data") count against a coin but aren't evidence. */
  fallback?: boolean;
  weight: number;
}

export type Evidence = "data" | "you" | "data + you" | "fallback" | "none";

export interface ScorecardCategory {
  key: CategoryKey;
  label: string;
  weight: number;
  why: string;
  score: number | null;
  evidence: Evidence;
  metrics: ScoreMetric[];
}

export interface FundamentalScore {
  /** The scorecard pulled toward UNKNOWN_SCORE by the share of evidence that's missing. */
  score: number | null;
  /** Weighted average of the categories that have a score, before the evidence adjustment. */
  rawScore: number | null;
  label: string;
  tone: Tone;
  /** Share of the scorecard's weight backed by real data or your rating (not fallbacks or gaps). */
  confidence: number;
  categories: ScorecardCategory[];
  strengths: string[];
  weaknesses: string[];
}

/** Scorecard inputs with nothing known, plus the given values: for partial scores (quick ranks, tests). */
export function faInputsWith(known: Partial<FaInputs> = {}): FaInputs {
  return {
    hasFees: false,
    feesExpected: true,
    feesGrowth30d: null,
    feesGrowth90d: null,
    feesAnnualized: null,
    tvlChange7d: null,
    holderShare: null,
    revenueShare: null,
    holdersRevenueAnnualized: null,
    circulatingRatio: null,
    inflation: null,
    fdvToMcap: null,
    unlocks90: null,
    category: null,
    categoryShare: null,
    categoryRank: null,
    categoryPeers: null,
    commits4w: null,
    devCommits12w: null,
    devTrend: null,
    contributors: null,
    governance90d: null,
    stablecoinChange30d: null,
    chainLaunches90d: null,
    ageDays: null,
    audits: null,
    hacks: null,
    tier1: null,
    priceToFees: null,
    priceToSales: null,
    mcapToTvl: null,
    usageVsPrice: null,
    narrativeLoaded: true,
    narrative: null,
    ratings: null,
    ...known,
  };
}

export const usageVsPrice = (feesGrowth90d: number | null | undefined, priceChange90d: number | null | undefined) =>
  feesGrowth90d != null && priceChange90d != null && priceChange90d > -1 ? (1 + feesGrowth90d) / (1 + priceChange90d) - 1 : null;

const known = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

function m(label: string, value: number | null | undefined, fmt: (v: number) => string, score: (v: number) => number, weight: number): ScoreMetric {
  return known(value) ? { label, display: fmt(value), score: Math.round(score(value)), weight } : { label, display: "—", score: null, weight };
}
const fallback = (label: string, display: string, score: number, weight = 1): ScoreMetric => ({ label, display, score, weight, fallback: true });
const rating = (label: string, v: number | null | undefined, weight: number): ScoreMetric =>
  known(v) ? { label, display: `${v}/10`, score: v * 10, weight } : { label, display: "Not rated", score: null, weight };

const pct = (v: number) => fmtPct(v);
const pctAbs = (v: number) => fmtPct(v, { signed: false });
/** Fee growth: more is better up to doubling; beyond 3× it's usually a spike that doesn't last. */
const GROWTH: [number, number][] = [
  [-0.5, 5],
  [0, 45],
  [0.3, 80],
  [1, 100],
  [3, 70],
];

function categoryMetrics(key: CategoryKey, i: FaInputs): ScoreMetric[] {
  const r = i.ratings;
  // Not fee-based and no fees: still not evidence, but scored as unknown rather than as weak.
  const unmeasured = !i.hasFees && !i.feesExpected;
  switch (key) {
    case "useCase":
      return [rating("Your rating", r?.useCase, 1)];
    case "narrative":
      if (i.narrative) return [{ label: "Narrative stage", display: `${i.narrative.stage} (${i.narrative.sector})`, score: i.narrative.strength, weight: 1 }];
      return i.narrativeLoaded ? [fallback("Narrative stage", "No tracked narrative", 30)] : [{ label: "Narrative stage", display: "Not loaded", score: null, weight: 1 }];
    case "adoption":
      if (unmeasured) return [fallback("Fees", "Not a fee-based model: unmeasured", UNKNOWN_SCORE)];
      if (!i.hasFees) return [fallback("Fees", "None tracked on DefiLlama", 25)];
      return [
        m("Fee growth (90d vs prior 90d)", i.feesGrowth90d, pct, (v) => curve(GROWTH, v), 40),
        m("Fee growth (30d vs prior 30d)", i.feesGrowth30d, pct, (v) => curve(GROWTH, v), 25),
        m("Fees (annualized)", i.feesAnnualized, fmtUsd, (v) => logCurve([[1e5, 5], [1e6, 30], [1e7, 60], [1e8, 85], [1e9, 100]], v), 20),
        m("TVL change (7d)", i.tvlChange7d, pct, (v) => curve([[-0.15, 10], [0, 50], [0.1, 80], [0.3, 100]], v), 15),
        // Chains only: capital and builders arriving.
        m("Stablecoins on chain (30d change)", i.stablecoinChange30d, pct, (v) => curve([[-0.2, 10], [0, 45], [0.1, 75], [0.3, 100]], v), 15),
        m("New protocols on chain (90d)", i.chainLaunches90d, fmtNum, (v) => logCurve([[1, 10], [5, 40], [20, 70], [60, 100]], Math.max(v, 1)), 10),
      ];
    case "valueCapture":
      if (unmeasured) return [fallback("Value capture", "Not a fee-based model: unmeasured", UNKNOWN_SCORE)];
      if (!i.hasFees) return [fallback("Value capture", "No fee data", 20)];
      return [
        // Holders revenue missing while fees exist means holders get nothing measurable.
        m("Share of fees to token holders", i.holderShare ?? 0, pctAbs, (v) => curve([[0, 15], [0.1, 50], [0.3, 80], [0.6, 100]], v), 45),
        m("Share of fees kept as revenue", i.revenueShare, pctAbs, (v) => curve([[0, 10], [0.1, 40], [0.3, 70], [0.6, 90], [1, 100]], v), 35),
        // Only when holders get something; "nothing" is already covered by the share above.
        m("Holders revenue (annualized)", i.holdersRevenueAnnualized || null, fmtUsd, (v) => logCurve([[1e4, 5], [1e6, 40], [1e7, 70], [1e8, 100]], v), 20),
      ];
    case "tokenomics":
      return [
        m("Circulating supply", i.circulatingRatio, pctAbs, (v) => curve([[0.15, 5], [0.4, 40], [0.7, 75], [0.95, 100]], v), 40),
        m("Supply inflation (annualized)", i.inflation, pct, (v) => curve([[0, 100], [0.05, 85], [0.15, 55], [0.3, 25], [0.6, 0]], v), 35),
        m("FDV ÷ market cap", i.fdvToMcap, fmtX, (v) => curve([[1, 100], [1.5, 70], [3, 30], [6, 5]], v), 25),
        // New supply landing inside a 1–6 month hold: a few % is normal, 10%+ of circulating is heavy selling pressure.
        m("Unlocks in the next 90 days", i.unlocks90, (v) => `${fmtPct(v, { signed: false })} of circulating`, (v) => curve([[0, 100], [0.02, 85], [0.05, 60], [0.1, 30], [0.25, 5]], v), 30),
      ];
    case "moat": {
      const share = known(i.categoryShare)
        ? m(
            `Share of ${i.category ?? "category"} fees`,
            i.categoryShare,
            (v) => `${fmtPct(v, { signed: false })}${i.categoryRank ? ` (#${i.categoryRank} of ${i.categoryPeers})` : ""}`,
            (v) => curve([[0.01, 15], [0.05, 40], [0.15, 70], [0.35, 90], [0.6, 100]], v),
            1,
          )
        : { label: "Share of category fees", display: "—", score: null, weight: 1 };
      return [share, rating("Your rating", r?.moat, 1)];
    }
    case "execution": {
      const h = i.hacks;
      const hackScore = !h ? null : h.count === 0 ? 90 : h.daysSinceLast !== null && h.daysSinceLast < 365 ? 10 : 40;
      // GitHub's 12-week count is the better measure; CoinGecko's 4-week count is the fallback.
      const commits = known(i.devCommits12w)
        ? m("Developer commits (12 weeks, GitHub)", i.devCommits12w, fmtNum, (v) => curve([[0, 10], [30, 40], [150, 75], [450, 100]], v), 15)
        : m("Developer commits (4 weeks)", i.commits4w, fmtNum, (v) => curve([[0, 10], [10, 40], [50, 75], [150, 100]], v), 15);
      return [
        commits,
        m("Developer trend (12w vs prior 12w)", i.devTrend, pct, (v) => curve([[-0.6, 10], [-0.2, 35], [0, 55], [0.3, 85], [1, 100]], v), 10),
        m("Contributors (all time)", i.contributors, fmtNum, (v) => logCurve([[1, 5], [10, 35], [50, 65], [200, 90], [500, 100]], Math.max(v, 1)), 10),
        m("Governance proposals (90d)", i.governance90d, fmtNum, (v) => curve([[0, 20], [1, 50], [5, 80], [15, 100]], v), 5),
        m("Track record (age)", i.ageDays, (v) => `${(v / 365).toFixed(1)} yrs`, (v) => curve([[90, 5], [365, 35], [1095, 70], [2190, 100]], v), 15),
        m("Audits", i.audits, fmtNum, (v) => curve([[0, 20], [1, 60], [3, 90]], v), 10),
        {
          label: "Hacks on record",
          display: !h ? "—" : h.count === 0 ? "None" : `${h.count}${h.daysSinceLast !== null ? `, last ${Math.round(h.daysSinceLast / 30)} months ago` : ""}`,
          score: hackScore,
          weight: 10,
        },
        m("Tier-1 exchange listings", i.tier1, fmtNum, (v) => curve([[0, 5], [1, 45], [3, 80], [5, 100]], v), 5),
        rating("Your team rating", r?.team, 20),
      ];
    }
    case "valuation":
      if (!i.hasFees && !known(i.mcapToTvl)) return [fallback("Valuation", "Nothing to anchor it to", unmeasured ? UNKNOWN_SCORE : 15)];
      return [
        m("Usage vs price (90d)", i.usageVsPrice, pct, (v) => curve([[-0.5, 10], [0, 50], [0.5, 85], [1.5, 100]], v), 35),
        m("Price-to-fees", i.priceToFees, fmtX, (v) => logCurve([[3, 100], [10, 90], [30, 70], [100, 40], [300, 15], [1000, 0]], v), 30),
        m("Price-to-sales (revenue)", i.priceToSales, fmtX, (v) => logCurve([[5, 100], [20, 85], [50, 65], [150, 35], [500, 10]], v), 20),
        m("Market cap ÷ TVL", i.mcapToTvl, fmtX, (v) => logCurve([[0.3, 95], [1, 75], [3, 45], [10, 15]], v), 15),
      ];
  }
}

function evidenceOf(metrics: ScoreMetric[]): Evidence {
  const scored = metrics.filter((x) => x.score !== null);
  if (!scored.length) return "none";
  const data = scored.some((x) => !x.fallback && !x.label.startsWith("Your"));
  const you = scored.some((x) => x.label.startsWith("Your"));
  if (data && you) return "data + you";
  if (data) return "data";
  if (you) return "you";
  return "fallback";
}

/** The parts of a category that combining needs (so weights can be varied cheaply in sensitivity tests). */
export interface CategoryResult {
  key: CategoryKey;
  weight: number;
  score: number | null;
  evidence: Evidence;
}

/**
 * Weighted average of the scored categories, then the evidence adjustment.
 * Needs at least 40% of the weight scored. `evidenceBase` limits which
 * categories count toward confidence.
 */
export function combineCategories(categories: CategoryResult[], evidenceBase?: CategoryKey[]): { score: number | null; rawScore: number | null; confidence: number } {
  const base = evidenceBase ? categories.filter((c) => evidenceBase.includes(c.key)) : categories;
  const total = base.reduce((s, c) => s + c.weight, 0);
  const scored = categories.filter((c) => c.score !== null && c.weight > 0);
  const scoredWeight = scored.reduce((s, c) => s + c.weight, 0);
  const evidenced = base.filter((c) => c.evidence !== "none" && c.evidence !== "fallback").reduce((s, c) => s + c.weight, 0);
  const confidence = total ? evidenced / total : 0;
  const rawScore = total && scoredWeight / total >= 0.4 ? scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / scoredWeight : null;
  // Thin evidence pulls a good score toward "unknown", so a few good metrics can't make a coin look strong.
  // It only ever lowers a score: missing data must not lift a weak coin either.
  const score = rawScore === null ? null : Math.round(Math.min(rawScore, rawScore * confidence + UNKNOWN_SCORE * (1 - confidence)));
  return { score, rawScore, confidence };
}

/** What missing evidence is assumed to be worth: a little below average. Good scores are pulled toward it, weak ones are left alone. */
export const UNKNOWN_SCORE = 45;

/**
 * `evidenceBase` limits which categories count toward evidence confidence
 * (the backtest passes the ones it can replay, so its scores stay comparable).
 */
export function scoreFundamentals(i: FaInputs, opts: { evidenceBase?: CategoryKey[] } = {}): FundamentalScore {
  const categories: ScorecardCategory[] = CATEGORIES.map((c) => {
    const metrics = categoryMetrics(c.key, i);
    const scored = metrics.filter((x) => x.score !== null);
    const w = scored.reduce((s, x) => s + x.weight, 0);
    return {
      ...c,
      metrics,
      score: w ? Math.round(scored.reduce((s, x) => s + (x.score as number) * x.weight, 0) / w) : null,
      evidence: evidenceOf(metrics),
    };
  });
  const { score, rawScore, confidence } = combineCategories(categories, opts.evidenceBase);
  const [label, tone]: [string, Tone] =
    score === null ? ["Not enough data", "neutral"] : score >= 70 ? ["Strong", "good"] : score >= 55 ? ["Solid", "good"] : score >= 40 ? ["Mixed", "neutral"] : ["Weak", "bad"];

  const all = categories.flatMap((c) => c.metrics.filter((x) => x.score !== null && !x.label.startsWith("Your")).map((x) => ({ ...x, category: c.label })));
  const line = (x: ScoreMetric) => `${x.label}: ${x.display}`;
  return {
    score,
    rawScore: rawScore === null ? null : Math.round(rawScore),
    label,
    tone,
    confidence,
    categories,
    strengths: all.filter((x) => (x.score as number) >= 75).sort((a, b) => (b.score as number) - (a.score as number)).slice(0, 5).map(line),
    weaknesses: all.filter((x) => (x.score as number) <= 30).sort((a, b) => (a.score as number) - (b.score as number)).slice(0, 5).map(line),
  };
}

const DAY = 86_400_000;

/** Scorecard inputs from a coin profile (plus the user's research, if any). */
export function faInputs(p: ProfileCore, research?: CoinResearch | null): FaInputs {
  const f = p.fundamentals;
  const last = f?.hacks?.last;
  return {
    hasFees: f?.feesAnnualized != null,
    feesExpected: feesExpected(p.categories ?? []),
    feesGrowth30d: f?.feesGrowth30d ?? null,
    feesGrowth90d: f?.feesGrowth90d ?? null,
    feesAnnualized: f?.feesAnnualized ?? null,
    tvlChange7d: f?.tvlChange7d ?? null,
    holderShare: f?.holderShare ?? null,
    revenueShare: f?.revenueShare ?? null,
    holdersRevenueAnnualized: f?.holdersRevenue30d != null ? f.holdersRevenue30d * (365 / 30) : null,
    circulatingRatio: p.tokenomics.circulatingRatio,
    inflation: p.tokenomics.inflationAnnual,
    fdvToMcap: p.tokenomics.fdvToMcap,
    unlocks90: p.unlocks?.next90 ?? null,
    category: f?.category ?? null,
    categoryShare: f?.categoryShare ?? null,
    categoryRank: f?.categoryRank ?? null,
    categoryPeers: f?.categoryPeers ?? null,
    commits4w: p.dev?.commits4w ?? null,
    devCommits12w: p.devActivity?.commits12w ?? null,
    devTrend: p.devActivity && p.devActivity.commitsPrev12w > 0 ? p.devActivity.commits12w / p.devActivity.commitsPrev12w - 1 : null,
    contributors: p.devActivity?.contributors ?? null,
    governance90d: p.governance?.proposals90d ?? null,
    stablecoinChange30d: f?.stablecoins?.change30d ?? null,
    chainLaunches90d: f?.launches?.last90 ?? null,
    ageDays: p.ageDays,
    audits: f?.kind === "protocol" ? (f.audits ?? 0) : null,
    hacks: f?.kind === "protocol" && f.hacks ? { count: f.hacks.count, daysSinceLast: last ? (Date.now() - Date.parse(last)) / DAY : null } : null,
    tier1: p.liquidity ? p.liquidity.tier1.length : null,
    priceToFees: f?.priceToFees ?? null,
    priceToSales: f?.priceToSales ?? null,
    mcapToTvl: f?.mcapToTvl ?? null,
    usageVsPrice: usageVsPrice(f?.feesGrowth90d, p.technicals.return90d),
    narrativeLoaded: p.narrativeLoaded ?? false,
    narrative: p.narrative?.stage ? { sector: p.narrative.sector, stage: p.narrative.stage, strength: p.narrative.strength } : null,
    ratings: research?.ratings ?? null,
  };
}

export const fundamentalsFor = (p: CoinProfile, research?: CoinResearch | null) => scoreFundamentals(faInputs(p, research));
