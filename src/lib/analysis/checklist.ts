// Turns a set of winning coins into a weighted checklist. Pure and client-safe,
// so the dashboard can rebuild or re-score instantly without refetching.
//
// Winners are measured at their breakout (the moment a buyer could have spotted
// the move), not at the top, so the checklist describes a *setup*, not the outcome.

import type { Checklist, ChecklistItem, CoinProfile, MetricItem, MetricKey, Snapshot } from "@/lib/types";
import { fmtNum, fmtPct, fmtUsd, fmtX } from "@/lib/format";
import { isGenericCategory } from "./categories";

export type Unit = "x" | "pct" | "usd" | "count";

interface BaseDef {
  label: string;
  why: string;
  unit: Unit;
  op: ">=" | "<=";
  /** Candidate thresholds, strictest first. The strictest one most winners pass is chosen. */
  ladder: number[];
  importance: 1 | 2 | 3;
}

/** Chart-derived: read from the winner's breakout snapshot, the candidate's current one, or any past day (backtest). */
interface SetupDef extends BaseDef {
  timing: "setup";
  snap: (s: Snapshot) => number | null;
}

/** Current-only data (supply, fundamentals, listings): no history, so not backtestable. */
interface StaticDef extends BaseDef {
  timing: "static";
  stat: (p: CoinProfile) => number | null;
}

export type MetricDef = SetupDef | StaticDef;

export const METRICS: Record<MetricKey, MetricDef> = {
  volTrend: {
    label: "Volume trend (7d vs prior 30d)",
    why: "Rising volume before a breakout signals fresh demand arriving.",
    unit: "x",
    op: ">=",
    ladder: [3, 2, 1.5, 1.2],
    importance: 3,
    timing: "setup",
    snap: (s) => s.volTrend,
  },
  relStrength: {
    label: "14-day return vs BTC",
    why: "Coins that lead BTC early in a move often keep leading.",
    unit: "pct",
    op: ">=",
    ladder: [0.2, 0.1, 0.05, 0],
    importance: 3,
    timing: "setup",
    snap: (s) => s.relStrength14d,
  },
  marketCap: {
    label: "Market cap",
    why: "Smaller caps need less new money to move.",
    unit: "usd",
    op: "<=",
    ladder: [50e6, 100e6, 250e6, 500e6, 1e9, 5e9, 20e9],
    importance: 2,
    timing: "setup",
    snap: (s) => s.marketCap,
  },
  turnover: {
    label: "Turnover (7d avg volume ÷ market cap)",
    why: "Actively traded coins can absorb buying without stalling.",
    unit: "pct",
    op: ">=",
    ladder: [0.2, 0.1, 0.05, 0.02],
    importance: 2,
    timing: "setup",
    snap: (s) => s.turnover,
  },
  vsSma50: {
    label: "Price vs 50-day average",
    why: "Trading above the 50-day average means the trend has turned up.",
    unit: "pct",
    op: ">=",
    ladder: [0.1, 0.05, 0],
    importance: 2,
    timing: "setup",
    snap: (s) => s.vsSma50,
  },
  fromHighDeep: {
    label: "Distance below 180-day high",
    why: "Deeply discounted coins have room to mean-revert.",
    unit: "pct",
    op: "<=",
    ladder: [-0.7, -0.5, -0.3],
    importance: 1,
    timing: "setup",
    snap: (s) => s.fromHigh,
  },
  fromHighNear: {
    label: "Distance below 180-day high",
    why: "Coins near their highs have few trapped sellers overhead.",
    unit: "pct",
    op: ">=",
    ladder: [-0.05, -0.1, -0.2],
    importance: 1,
    timing: "setup",
    snap: (s) => s.fromHigh,
  },
  circulatingRatio: {
    label: "Circulating supply share",
    why: "Most supply already circulating means less unlock and dilution pressure.",
    unit: "pct",
    op: ">=",
    ladder: [0.9, 0.75, 0.6],
    importance: 2,
    timing: "static",
    stat: (p) => p.supply.circulatingRatio,
  },
  lowFloat: {
    label: "Circulating supply share",
    why: "A low float keeps supply tight, which can amplify moves (but adds unlock risk).",
    unit: "pct",
    op: "<=",
    ladder: [0.25, 0.4],
    importance: 1,
    timing: "static",
    stat: (p) => p.supply.circulatingRatio,
  },
  tvlGrowth: {
    label: "TVL change (7d)",
    why: "Capital flowing into the protocol or chain backs the price move.",
    unit: "pct",
    op: ">=",
    ladder: [0.2, 0.1, 0.05, 0],
    importance: 2,
    timing: "static",
    stat: (p) => p.fundamentals?.tvlChange7d ?? null,
  },
  mcapToTvl: {
    label: "Market cap ÷ TVL",
    why: "Lower means you pay less per dollar locked in the protocol.",
    unit: "x",
    op: "<=",
    ladder: [0.5, 1, 2, 5],
    importance: 2,
    timing: "static",
    stat: (p) => p.fundamentals?.mcapToTvl ?? null,
  },
  fees30d: {
    label: "Fees (30d)",
    why: "Real usage that people pay for.",
    unit: "usd",
    op: ">=",
    ladder: [10e6, 1e6, 100e3],
    importance: 2,
    timing: "static",
    stat: (p) => p.fundamentals?.fees30d ?? null,
  },
  devCommits: {
    label: "GitHub commits (4 weeks)",
    why: "Active development means the team is still shipping.",
    unit: "count",
    op: ">=",
    ladder: [100, 50, 20, 5],
    importance: 1,
    timing: "static",
    stat: (p) => p.dev?.commits4w ?? null,
  },
  sentiment: {
    label: "Bullish community votes",
    why: "Strong community conviction supports demand.",
    unit: "pct",
    op: ">=",
    ladder: [0.85, 0.75, 0.65],
    importance: 1,
    timing: "static",
    stat: (p) => p.sentimentUp,
  },
  rsi: {
    label: "RSI (14)",
    why: "Momentum strength: 50–70 is a healthy uptrend.",
    unit: "count",
    op: ">=",
    ladder: [65, 60, 55, 50],
    importance: 1,
    timing: "setup",
    snap: (s) => s.rsi14,
  },
  priceToFees: {
    label: "Price-to-fees (P/F)",
    why: "Market cap ÷ annualized fees. Lower = cheaper for the usage.",
    unit: "x",
    op: "<=",
    ladder: [10, 25, 50, 100],
    importance: 2,
    timing: "static",
    stat: (p) => p.fundamentals?.priceToFees ?? null,
  },
  feesGrowth: {
    label: "Fee growth (30d vs prior 30d)",
    why: "Accelerating usage often leads price.",
    unit: "pct",
    op: ">=",
    ladder: [0.5, 0.25, 0.1, 0],
    importance: 2,
    timing: "static",
    stat: (p) => p.fundamentals?.feesGrowth30d ?? null,
  },
  tier1: {
    label: "Tier-1 exchange listings",
    why: "Access to big pools of capital.",
    unit: "count",
    op: ">=",
    ladder: [5, 3, 2, 1],
    importance: 1,
    timing: "static",
    stat: (p) => p.liquidity?.tier1.length ?? null,
  },
  inflation: {
    label: "Supply inflation (annualized)",
    why: "Slow supply growth means less dilution.",
    unit: "pct",
    op: "<=",
    ladder: [0.02, 0.05, 0.1, 0.2],
    importance: 1,
    timing: "static",
    stat: (p) => p.tokenomics?.inflationAnnual ?? null,
  },
};

/** Metric pairs that contradict each other; only the more common one is kept. */
const EXCLUSIVE: [MetricKey, MetricKey][] = [
  ["fromHighDeep", "fromHighNear"],
  ["circulatingRatio", "lowFloat"],
];

const MAX_CATEGORIES = 4;

export function passes(op: ">=" | "<=", value: number, threshold: number): boolean {
  return op === ">=" ? value >= threshold : value <= threshold;
}

export function formatMetric(unit: Unit, v: number | null): string {
  if (v === null) return "—";
  switch (unit) {
    case "x":
      return fmtX(v);
    case "pct":
      return fmtPct(v, { signed: v < 0 });
    case "usd":
      return fmtUsd(v);
    case "count":
      return fmtNum(v);
  }
}

/** Threshold ↔ the number shown in the edit box (percent for pct, millions for usd). */
export const inputScale: Record<Unit, { factor: number; suffix: string }> = {
  x: { factor: 1, suffix: "×" },
  pct: { factor: 100, suffix: "%" },
  usd: { factor: 1e-6, suffix: "M $" },
  count: { factor: 1, suffix: "" },
};

const finite = (v: number | null | undefined) => (v !== null && v !== undefined && Number.isFinite(v) ? v : null);

export function winnerValue(def: MetricDef, w: CoinProfile): number | null {
  return finite(def.timing === "setup" ? def.snap(w.setup) : def.stat(w));
}

export function candidateValue(def: MetricDef, c: CoinProfile): number | null {
  return finite(def.timing === "setup" ? def.snap(c.now) : def.stat(c));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 1–5 weight from how important the metric is and how many winners shared it. */
function toWeight(importance: number, prevalence: number): number {
  return Math.min(5, Math.max(1, Math.round((importance * prevalence * 5) / 3)));
}

export function buildChecklist(winners: CoinProfile[]): Checklist {
  const n = winners.length;
  const need = (known: number) => Math.max(1, Math.ceil(known * 0.6));
  const minKnown = Math.max(1, Math.ceil(n / 2));
  const metricItems: MetricItem[] = [];

  for (const [key, def] of Object.entries(METRICS) as [MetricKey, MetricDef][]) {
    const values = winners.flatMap((w) => {
      const v = winnerValue(def, w);
      return v === null ? [] : [{ id: w.id, v }];
    });
    if (values.length < minKnown) continue;

    const threshold = def.ladder.find((t) => values.filter((x) => passes(def.op, x.v, t)).length >= need(values.length));
    if (threshold === undefined) continue;

    const matched = values.filter((x) => passes(def.op, x.v, threshold)).map((x) => x.id);
    metricItems.push({
      id: key,
      kind: "metric",
      metric: key,
      op: def.op,
      threshold,
      weight: toWeight(def.importance, matched.length / n),
      enabled: true,
      matched,
      known: values.length,
      winnerMedian: median(values.map((x) => x.v)),
    });
  }

  for (const [a, b] of EXCLUSIVE) {
    const ia = metricItems.find((m) => m.metric === a);
    const ib = metricItems.find((m) => m.metric === b);
    if (ia && ib) metricItems.splice(metricItems.indexOf(ia.matched.length >= ib.matched.length ? ib : ia), 1);
  }

  const byCategory = new Map<string, string[]>();
  for (const w of winners) for (const c of w.categories) byCategory.set(c, [...(byCategory.get(c) ?? []), w.id]);
  const shared = [...byCategory].filter(([, ids]) => ids.length >= need(n)).sort((a, b) => b[1].length - a[1].length);
  // Broad tags ("Ethereum Ecosystem", "Governance") say little about a move, so at most one is kept.
  const categoryItems: ChecklistItem[] = [
    ...shared.filter(([c]) => !isGenericCategory(c)),
    ...shared.filter(([c]) => isGenericCategory(c)).slice(0, 1),
  ]
    .slice(0, MAX_CATEGORIES)
    .map(([category, ids]) => ({
      id: `cat:${category}`,
      kind: "category",
      category,
      weight: toWeight(2, ids.length / n),
      enabled: true,
      matched: ids,
      known: n,
    }));

  const notes: string[] = [];
  if (n < 3) {
    notes.push(`Built from only ${n} winner${n === 1 ? "" : "s"}, so the checklist mirrors ${n === 1 ? "it" : "them"} closely. Add 3 or more winners for a more general pattern.`);
  }
  const noRally = winners.filter((w) => !w.rally).map((w) => w.name);
  if (noRally.length) {
    notes.push(`${noRally.join(", ")} had no 20%+ rally in the last 90 days, so current readings were used instead of breakout readings.`);
  }

  return {
    createdAt: new Date().toISOString(),
    winners: winners.map((w) => ({ id: w.id, name: w.name, symbol: w.symbol, thumb: w.image ?? undefined })),
    items: [...metricItems, ...categoryItems].sort((a, b) => b.weight - a.weight),
    notes,
  };
}

export function describeItem(item: ChecklistItem): { label: string; why: string; target: string } {
  if (item.kind === "category") {
    return { label: `Sector: ${item.category}`, why: "Winners shared this narrative/sector tag.", target: "Tagged" };
  }
  const def = METRICS[item.metric];
  return { label: def.label, why: def.why, target: `${item.op === ">=" ? "≥" : "≤"} ${formatMetric(def.unit, item.threshold)}` };
}
