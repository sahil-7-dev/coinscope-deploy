// Thesis tracking: your assumptions about a coin, each optionally tied to a
// data check ("fee growth over 90 days ≥ 0%"), re-run against the latest data
// so you notice when the evidence turns against what you wrote.
// Pure and client-safe.

import type { Assumption, AssumptionCheck, CheckMetric, CoinProfile, CoinResearch, NarrativeStage, Thesis } from "@/lib/types";
import { fmtNum, fmtPct, fmtX } from "@/lib/format";
import { fundamentalsFor } from "./fundamentals";

type Unit = "pct" | "x" | "score" | "count" | "stage";

export const CHECK_METRICS: Record<CheckMetric, { label: string; unit: Unit; read: (p: CoinProfile, research: CoinResearch | null) => number | string | null }> = {
  fundamentalScore: { label: "Fundamental score", unit: "score", read: (p, r) => fundamentalsFor(p, r).score },
  feesGrowth90d: { label: "Fee growth (90d vs prior 90d)", unit: "pct", read: (p) => p.fundamentals?.feesGrowth90d ?? null },
  feesGrowth30d: { label: "Fee growth (30d vs prior 30d)", unit: "pct", read: (p) => p.fundamentals?.feesGrowth30d ?? null },
  holderShare: {
    label: "Share of fees to token holders",
    unit: "pct",
    read: (p) => (p.fundamentals?.feesAnnualized != null ? (p.fundamentals.holderShare ?? 0) : null),
  },
  priceToFees: { label: "Price-to-fees", unit: "x", read: (p) => p.fundamentals?.priceToFees ?? null },
  inflation: { label: "Supply inflation (annualized)", unit: "pct", read: (p) => p.tokenomics?.inflationAnnual ?? null },
  devCommits12w: { label: "GitHub commits (12 weeks)", unit: "count", read: (p) => p.devActivity?.commits12w ?? null },
  riskScore: { label: "Risk score", unit: "score", read: (p) => p.scores?.risk?.score ?? null },
  narrativeStage: { label: "Narrative stage", unit: "stage", read: (p) => p.narrative?.stage ?? null },
};

export function formatCheckValue(metric: CheckMetric, v: number | string | null): string {
  if (v === null) return "—";
  if (typeof v === "string") return v;
  switch (CHECK_METRICS[metric].unit) {
    case "pct":
      return fmtPct(v);
    case "x":
      return fmtX(v);
    default:
      return fmtNum(v);
  }
}

/** "Fee growth (90d) ≥ +0%", "Narrative stage is Accelerating or Emerging". */
export function describeCheck(c: AssumptionCheck): string {
  const m = CHECK_METRICS[c.metric];
  if (c.op === "in") return `${m.label} is ${(c.stages ?? []).join(" or ") || "…"}`;
  return `${m.label} ${c.op === ">=" ? "≥" : "≤"} ${formatCheckValue(c.metric, c.value)}`;
}

export type AssumptionStatus = "holds" | "broken" | "no data" | "unchecked";

export interface AssumptionResult {
  assumption: Assumption;
  status: AssumptionStatus;
  /** The current value, formatted. */
  current: string;
  rule: string | null;
}

export function checkAssumption(a: Assumption, p: CoinProfile, research: CoinResearch | null): AssumptionResult {
  const c = a.check;
  if (!c) return { assumption: a, status: "unchecked", current: "—", rule: null };
  const v = CHECK_METRICS[c.metric].read(p, research);
  const rule = describeCheck(c);
  if (v === null) return { assumption: a, status: "no data", current: "—", rule };
  let holds: boolean;
  if (c.op === "in") holds = (c.stages ?? []).includes(v as NarrativeStage);
  else if (typeof v !== "number" || c.value === null) return { assumption: a, status: "no data", current: formatCheckValue(c.metric, v), rule };
  else holds = c.op === ">=" ? v >= c.value : v <= c.value;
  return { assumption: a, status: holds ? "holds" : "broken", current: formatCheckValue(c.metric, v), rule };
}

export interface ThesisStatus {
  results: AssumptionResult[];
  broken: AssumptionResult[];
  /** The review date has arrived (or passed). */
  reviewDue: boolean;
  hasThesis: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

export const EMPTY_THESIS: Thesis = { stance: null, summary: "", assumptions: [], reviewOn: null };

export function thesisStatus(research: CoinResearch | null | undefined, p: CoinProfile): ThesisStatus {
  const t = research?.thesis ?? EMPTY_THESIS;
  const results = t.assumptions.filter((a) => a.text.trim() || a.check).map((a) => checkAssumption(a, p, research ?? null));
  return {
    results,
    broken: results.filter((r) => r.status === "broken"),
    reviewDue: !!t.reviewOn && t.reviewOn <= today(),
    hasThesis: !!(t.stance || t.summary.trim() || results.length),
  };
}

/** A short label for an assumption in logs and alerts. */
export const assumptionLabel = (a: Assumption) => a.text.trim() || (a.check ? describeCheck(a.check) : "Untitled assumption");

/**
 * Assumptions whose latest logged check broke, from the history alone (no fresh
 * profile needed): what the Watchlist shows before a refresh.
 */
export function brokenFromHistory(research: CoinResearch | null | undefined, events: { kind: string; ref?: string | null }[]): Assumption[] {
  const latest = new Map<string, string>();
  // Events arrive newest first, so the first one seen per assumption is its latest.
  for (const e of events) if (e.ref && (e.kind === "assumption-broken" || e.kind === "assumption-holds") && !latest.has(e.ref)) latest.set(e.ref, e.kind);
  return (research?.thesis.assumptions ?? []).filter((a) => latest.get(a.id) === "assumption-broken");
}
