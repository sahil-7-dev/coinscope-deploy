// Fundamental similarity between a candidate coin and a benchmark (a coin that
// already performed well), factor by factor, plus a reusable "winner pattern"
// built from several benchmarks. Benchmarks can be compared as they are today
// or as they were the day their run began ("before its run"), which is what a
// candidate should look like now. Close values score high; each factor also
// says where the candidate is stronger or weaker, and missing data is listed.
// No technical analysis. Pure and client-safe.

import type { CoinProfile, NarrativeStage } from "@/lib/types";
import { fmtNum, fmtPct, fmtUsd, fmtX } from "@/lib/format";
import { isGenericCategory } from "./categories";

/** A coin's fundamentals at one moment: today, or the day before a winner's run began. */
export interface FundamentalSnapshot {
  id: string;
  name: string;
  symbol: string;
  /** YYYY-MM-DD the values are from, or null for today. */
  asOf: string | null;
  hasFees: boolean;
  fees30d: number | null;
  feesGrowth30d: number | null;
  feesGrowth90d: number | null;
  revenueGrowth90d: number | null;
  tvl: number | null;
  commits4w: number | null;
  holderShare: number | null;
  revenueShare: number | null;
  priceToFees: number | null;
  priceToSales: number | null;
  mcapToTvl: number | null;
  circulatingRatio: number | null;
  inflation: number | null;
  fdvToMcap: number | null;
  marketCap: number | null;
  ageDays: number | null;
  tier1: number | null;
  categories: string[];
  narrativeSector: string | null;
  narrativeStage: NarrativeStage | null;
  /** Caveats about values that are approximate on this date (e.g. market cap from today's supply). */
  approx?: string[];
}

/** Today's snapshot from a full profile. */
export function snapshotOf(p: CoinProfile): FundamentalSnapshot {
  const f = p.fundamentals;
  const hasFees = f?.feesAnnualized != null;
  return {
    id: p.id,
    name: p.name,
    symbol: p.symbol,
    asOf: null,
    hasFees,
    fees30d: f?.fees30d ?? null,
    feesGrowth30d: f?.feesGrowth30d ?? null,
    feesGrowth90d: f?.feesGrowth90d ?? null,
    revenueGrowth90d: f?.revenueGrowth90d ?? null,
    tvl: f?.tvl ?? null,
    commits4w: p.dev?.commits4w ?? null,
    holderShare: hasFees ? (f?.holderShare ?? 0) : null,
    revenueShare: f?.revenueShare ?? null,
    priceToFees: f?.priceToFees ?? null,
    priceToSales: f?.priceToSales ?? null,
    mcapToTvl: f?.mcapToTvl ?? null,
    circulatingRatio: p.tokenomics?.circulatingRatio ?? p.supply.circulatingRatio,
    inflation: p.tokenomics?.inflationAnnual ?? null,
    fdvToMcap: p.tokenomics?.fdvToMcap ?? null,
    marketCap: p.marketCap,
    ageDays: p.ageDays,
    tier1: p.liquidity ? p.liquidity.tier1.length : null,
    categories: p.categories,
    narrativeSector: p.narrative?.sector ?? null,
    narrativeStage: p.narrative?.stage ?? null,
  };
}

export type GroupKey = "usage" | "valueCapture" | "valuation" | "tokenomics" | "narrative" | "maturity";

export const GROUPS: { key: GroupKey; label: string; weight: number; why: string }[] = [
  { key: "usage", label: "Usage & growth", weight: 30, why: "Fees, fee and revenue growth, TVL, developer activity" },
  { key: "valueCapture", label: "Value capture", weight: 20, why: "How much of the fees reaches token holders and the protocol" },
  { key: "narrative", label: "Narrative", weight: 15, why: "Shared sectors and narrative stage" },
  { key: "valuation", label: "Valuation", weight: 15, why: "Price-to-fees, price-to-sales, market cap ÷ TVL" },
  { key: "tokenomics", label: "Tokenomics", weight: 10, why: "Circulating share, inflation, FDV overhang" },
  { key: "maturity", label: "Size & maturity", weight: 10, why: "Market cap, age, tier-1 listings" },
];

type Fmt = (v: number) => string;
type NumericKey = {
  [K in keyof FundamentalSnapshot]-?: FundamentalSnapshot[K] extends number | null ? K : never;
}[keyof FundamentalSnapshot];

interface Feature {
  key: NumericKey;
  group: GroupKey;
  label: string;
  fmt: Fmt;
  /** "log": compare orders of magnitude (span = decades until 0%); "linear": absolute difference (span = gap until 0%). */
  kind: "log" | "linear";
  span: number;
  /** Offset added before log (for counts that can be 0). */
  offset?: number;
  /** Missing on the candidate means "doesn't have it" (when the candidate has no fees) rather than "unknown". */
  absentIsMismatch?: boolean;
  /** Which direction is better for an investor, for the stronger/weaker comparison. */
  better: "higher" | "lower" | null;
}

const pct: Fmt = (v) => fmtPct(v);
const pctAbs: Fmt = (v) => fmtPct(v, { signed: false });

export const FEATURES: Feature[] = [
  { key: "fees30d", group: "usage", label: "Fees (30d)", fmt: fmtUsd, kind: "log", span: 2, offset: 1, absentIsMismatch: true, better: "higher" },
  { key: "feesGrowth30d", group: "usage", label: "Fee growth (30d)", fmt: pct, kind: "linear", span: 0.8, better: "higher" },
  { key: "feesGrowth90d", group: "usage", label: "Fee growth (90d)", fmt: pct, kind: "linear", span: 1, better: "higher" },
  { key: "revenueGrowth90d", group: "usage", label: "Revenue growth (90d)", fmt: pct, kind: "linear", span: 1, better: "higher" },
  { key: "tvl", group: "usage", label: "TVL", fmt: fmtUsd, kind: "log", span: 2, better: "higher" },
  { key: "commits4w", group: "usage", label: "Commits (4 wks)", fmt: fmtNum, kind: "log", span: 2, offset: 1, better: "higher" },
  { key: "holderShare", group: "valueCapture", label: "Share of fees to holders", fmt: pctAbs, kind: "linear", span: 0.5, better: "higher" },
  { key: "revenueShare", group: "valueCapture", label: "Share of fees kept as revenue", fmt: pctAbs, kind: "linear", span: 0.6, better: "higher" },
  { key: "priceToFees", group: "valuation", label: "Price-to-fees", fmt: fmtX, kind: "log", span: 1.5, absentIsMismatch: true, better: "lower" },
  { key: "priceToSales", group: "valuation", label: "Price-to-sales", fmt: fmtX, kind: "log", span: 1.5, better: "lower" },
  { key: "mcapToTvl", group: "valuation", label: "Market cap ÷ TVL", fmt: fmtX, kind: "log", span: 1.5, better: "lower" },
  { key: "circulatingRatio", group: "tokenomics", label: "Circulating supply", fmt: pctAbs, kind: "linear", span: 0.6, better: "higher" },
  { key: "inflation", group: "tokenomics", label: "Supply inflation", fmt: pct, kind: "linear", span: 0.4, better: "lower" },
  { key: "fdvToMcap", group: "tokenomics", label: "FDV ÷ market cap", fmt: fmtX, kind: "log", span: 0.8, better: "lower" },
  { key: "marketCap", group: "maturity", label: "Market cap", fmt: fmtUsd, kind: "log", span: 2, better: null },
  { key: "ageDays", group: "maturity", label: "Age", fmt: (v) => `${(v / 365).toFixed(1)} yrs`, kind: "log", span: 1, better: "higher" },
  { key: "tier1", group: "maturity", label: "Tier-1 listings", fmt: fmtNum, kind: "linear", span: 5, better: "higher" },
];

export interface FeatureResult {
  label: string;
  reference: string;
  candidate: string;
  /** 0–100, null if either side lacks data. */
  similarity: number | null;
  /** Where the candidate beats or trails the benchmark (null when about equal or not comparable). */
  edge: "stronger" | "weaker" | null;
  /** How big the gap is, in words ("21× smaller", "55 pts lower"), when it's meaningful. */
  gap: string | null;
}

export interface GroupResult {
  key: GroupKey;
  label: string;
  weight: number;
  score: number | null;
  features: FeatureResult[];
}

export interface SimilarityResult {
  referenceId: string;
  candidateId: string;
  /** Weighted 0–100 across groups with data. */
  overall: number | null;
  coverage: number;
  groups: GroupResult[];
  stronger: string[];
  weaker: string[];
  /** Metrics that couldn't be compared, and which side lacks them. */
  missing: string[];
}

const finite = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

function featureSimilarity(f: Feature, a: number, b: number): number {
  if (f.kind === "log") {
    const off = f.offset ?? 0;
    if (a + off <= 0 || b + off <= 0) return a === b ? 1 : 0;
    return Math.max(0, 1 - Math.abs(Math.log10(a + off) - Math.log10(b + off)) / f.span);
  }
  return Math.max(0, 1 - Math.abs(a - b) / f.span);
}

/** Stronger/weaker only when the gap is meaningful (10%+ apart, or 8% of the span for shares and growth rates). */
function edgeOf(f: Feature, ref: number, cand: number): FeatureResult["edge"] {
  if (!f.better) return null;
  const gap = f.kind === "log" ? (ref > 0 ? cand / ref - 1 : cand > 0 ? 1 : 0) : cand - ref;
  const threshold = f.kind === "log" ? 0.1 : f.span * 0.08;
  if (Math.abs(gap) < threshold) return null;
  return (gap > 0) === (f.better === "higher") ? "stronger" : "weaker";
}

/** The gap in words: multiples for amounts and ratios, points for shares and growth rates. */
function gapText(f: Feature, ref: number, cand: number): string | null {
  if (f.kind === "log") {
    if (!(ref > 0) || !(cand > 0)) return null;
    const r = cand / ref;
    if (r >= 0.67 && r <= 1.5) return null;
    return r > 1 ? `${fmtX(r)} ${f.key === "ageDays" ? "older" : "larger"}` : `${fmtX(1 / r)} ${f.key === "ageDays" ? "younger" : "smaller"}`;
  }
  const pts = (cand - ref) * (f.key === "tier1" ? 1 : 100);
  if (Math.abs(pts) < (f.key === "tier1" ? 1 : 10)) return null;
  return f.key === "tier1" ? `${pts > 0 ? "+" : ""}${pts} listings` : `${pts > 0 ? "+" : ""}${pts.toFixed(0)} pts`;
}

const specific = (categories: string[]) => new Set(categories.filter((c) => !isGenericCategory(c)).map((c) => c.toLowerCase()));

/** Narrative: overlap of specific sector tags (scaled so one shared core sector already counts), plus stage. */
function narrative(ref: FundamentalSnapshot, cand: FundamentalSnapshot): GroupResult {
  const a = specific(ref.categories);
  const b = specific(cand.categories);
  const shared = [...a].filter((c) => b.has(c));
  const overlap = a.size && b.size ? Math.min(1, (shared.length / Math.min(a.size, b.size)) * 1.5) : null;
  const named = (set: Set<string>, s: FundamentalSnapshot) => s.categories.filter((c) => set.has(c.toLowerCase())).slice(0, 3).join(", ") || "—";
  const features: FeatureResult[] = [
    {
      label: "Shared sectors",
      reference: named(a, ref),
      candidate: shared.length ? cand.categories.filter((c) => shared.includes(c.toLowerCase())).slice(0, 3).join(", ") : named(b, cand),
      similarity: overlap === null ? null : Math.round(overlap * 100),
      edge: null,
      gap: null,
    },
    {
      label: "Narrative stage",
      reference: ref.narrativeStage ? `${ref.narrativeStage} (${ref.narrativeSector})` : "—",
      candidate: cand.narrativeStage ? `${cand.narrativeStage} (${cand.narrativeSector})` : "—",
      similarity: ref.narrativeStage && cand.narrativeStage ? (ref.narrativeStage === cand.narrativeStage ? 100 : 50) : null,
      edge: null,
      gap: null,
    },
  ];
  const known = features.filter((f) => f.similarity !== null);
  const score = overlap === null ? null : Math.round(known.reduce((s, f) => s + (f.similarity as number), 0) / known.length);
  return { key: "narrative", label: "Narrative", weight: 15, score, features };
}

export function compareCoins(ref: FundamentalSnapshot, cand: FundamentalSnapshot): SimilarityResult {
  const missing: string[] = [];
  const groups: GroupResult[] = GROUPS.map((g) => {
    if (g.key === "narrative") return narrative(ref, cand);
    const features = FEATURES.filter((f) => f.group === g.key).map((f): FeatureResult => {
      const a = ref[f.key];
      const b = cand[f.key];
      // No fees at all means "doesn't earn any", not "unknown".
      const absent = f.absentIsMismatch && finite(a) && !finite(b) && !cand.hasFees;
      const both = finite(a) && finite(b);
      if (!both && !absent && (finite(a) || finite(b))) missing.push(`${f.label} (${finite(a) ? cand.symbol : `${ref.symbol}${ref.asOf ? " before its run" : ""}`} has no data)`);
      return {
        label: f.label,
        reference: finite(a) ? f.fmt(a) : "—",
        candidate: finite(b) ? f.fmt(b) : absent ? "None" : "—",
        similarity: absent ? 0 : both ? Math.round(featureSimilarity(f, a as number, b as number) * 100) : null,
        edge: absent ? "weaker" : both ? edgeOf(f, a as number, b as number) : null,
        gap: both ? gapText(f, a as number, b as number) : absent ? "none at all" : null,
      };
    });
    const known = features.filter((x) => x.similarity !== null);
    const score = known.length ? Math.round(known.reduce((s, x) => s + (x.similarity as number), 0) / known.length) : null;
    return { key: g.key, label: g.label, weight: g.weight, score, features };
  });

  const total = groups.reduce((s, g) => s + g.weight, 0);
  const known = groups.filter((g) => g.score !== null);
  const knownWeight = known.reduce((s, g) => s + g.weight, 0);
  const all = groups.flatMap((g) => g.features);
  const line = (f: FeatureResult) => `${f.label}: ${f.candidate} vs ${f.reference}${f.gap ? ` (${f.gap})` : ""}`;
  return {
    referenceId: ref.id,
    candidateId: cand.id,
    overall: knownWeight ? Math.round(known.reduce((s, g) => s + (g.score as number) * g.weight, 0) / knownWeight) : null,
    coverage: total ? knownWeight / total : 0,
    groups,
    stronger: all.filter((f) => f.edge === "stronger").map(line),
    weaker: all.filter((f) => f.edge === "weaker").map(line),
    missing,
  };
}

export function similarityLabel(score: number | null): { label: string; tone: "good" | "neutral" | "warn" | "bad" } {
  if (score === null) return { label: "No data", tone: "neutral" };
  if (score >= 75) return { label: "Very similar", tone: "good" };
  if (score >= 60) return { label: "Similar", tone: "good" };
  if (score >= 45) return { label: "Somewhat similar", tone: "neutral" };
  return { label: "Different", tone: "bad" };
}

// ---- Winner pattern: what several winners had in common before their runs ----

/** Winners this far apart on a metric (30×+ for amounts, more than the comparison span for rates) don't share a trait. */
const isTooWide = (f: Feature, min: number, max: number) => (f.kind === "log" ? (min > 0 ? max / min > 30 : max > 0) : max - min > f.span * 1.2);

export interface PatternMetric {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  median: number;
  /** Winners with data for this metric. */
  count: number;
  display: string;
  /** The winners disagree too much on this metric for it to tell anything (left out of the match). */
  tooWide: boolean;
}

/** Ranges for every metric that at least two of the winners have data for. */
export function buildPattern(winners: FundamentalSnapshot[]): PatternMetric[] {
  return FEATURES.flatMap((f) => {
    const vals = winners.map((w) => w[f.key]).filter(finite).sort((a, b) => a - b);
    if (vals.length < 2) return [];
    const mid = Math.floor(vals.length / 2);
    const median = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
    const [min, max] = [vals[0], vals[vals.length - 1]];
    const tooWide = isTooWide(f, min, max);
    return [{ key: f.key, label: f.label, min, max, median, count: vals.length, display: min === max ? f.fmt(min) : `${f.fmt(min)} to ${f.fmt(max)}`, tooWide }];
  });
}

export interface PatternMatch {
  score: number | null;
  inside: string[];
  outside: string[];
  missing: string[];
}

/**
 * How well a candidate sits inside the winners' ranges. Inside a range (with
 * some tolerance) scores 100; outside, the score falls off with distance from
 * the nearest edge, the same way the pairwise comparison does.
 */
export function matchPattern(pattern: PatternMetric[], cand: FundamentalSnapshot): PatternMatch {
  const out: PatternMatch = { score: null, inside: [], outside: [], missing: [] };
  const scores: number[] = [];
  for (const m of pattern) {
    if (m.tooWide) continue;
    const f = FEATURES.find((x) => x.key === m.key) as Feature;
    const v = cand[m.key];
    if (!finite(v)) {
      out.missing.push(m.label);
      continue;
    }
    const lo = f.kind === "log" ? m.min / 1.5 : m.min - f.span * 0.15;
    const hi = f.kind === "log" ? m.max * 1.5 : m.max + f.span * 0.15;
    if (v >= lo && v <= hi) {
      scores.push(100);
      out.inside.push(`${m.label}: ${f.fmt(v)} (winners: ${m.display})`);
    } else {
      scores.push(Math.round(featureSimilarity(f, v, v < lo ? lo : hi) * 100));
      out.outside.push(`${m.label}: ${f.fmt(v)} (winners: ${m.display})`);
    }
  }
  out.score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  return out;
}

/**
 * What the winners did *not* have in common: metrics where they differ too
 * much to form a range, metrics only some of them had, mixed narrative stages,
 * and fee earners mixed with non-earners. A pattern is only as strong as what's shared.
 */
export function patternDifferences(winners: FundamentalSnapshot[]): string[] {
  if (winners.length < 2) return [];
  const out: string[] = [];
  const earners = winners.filter((w) => w.hasFees);
  if (earners.length && earners.length < winners.length) {
    out.push(`Fees: only ${earners.map((w) => w.symbol).join(", ")} earned fees; ${winners.filter((w) => !w.hasFees).map((w) => w.symbol).join(", ")} didn't.`);
  }
  const stages = new Map<string, string[]>();
  for (const w of winners) stages.set(w.narrativeStage ?? "unknown", [...(stages.get(w.narrativeStage ?? "unknown") ?? []), w.symbol]);
  if (stages.size > 1) out.push(`Narrative stage: ${[...stages].map(([stage, syms]) => `${stage} (${syms.join(", ")})`).join(", ")}.`);
  for (const f of FEATURES) {
    const have = winners.filter((w) => finite(w[f.key]));
    if (have.length >= 2) {
      const vals = have.map((w) => w[f.key] as number);
      if (isTooWide(f, Math.min(...vals), Math.max(...vals))) out.push(`${f.label}: ${have.map((w) => `${w.symbol} ${f.fmt(w[f.key] as number)}`).join(", ")}, too far apart to be a shared trait.`);
    } else if (have.length === 1) out.push(`${f.label}: only ${have[0].symbol} had data.`);
  }
  return out;
}
