// Scores a candidate coin against a checklist. Pure and client-safe.

import type { Checklist, ChecklistItem, CoinProfile, Tone } from "@/lib/types";
import { candidateValue, describeItem, formatMetric, METRICS, passes } from "./checklist";

export type Status = "pass" | "fail" | "unknown";

export interface CriterionResult {
  item: ChecklistItem;
  label: string;
  target: string;
  status: Status;
  display: string;
}

export interface ScoreResult {
  profile: CoinProfile;
  /** 0–100: share of known checklist weight the coin passes. */
  score: number;
  /** Share of total weight that had data. */
  coverage: number;
  verdict: { label: string; tone: Tone };
  criteria: CriterionResult[];
}

function evaluate(item: ChecklistItem, c: CoinProfile): CriterionResult {
  const { label, target } = describeItem(item);
  if (item.kind === "category") {
    const has = c.categories.some((x) => x.toLowerCase() === item.category.toLowerCase());
    return { item, label, target, status: has ? "pass" : "fail", display: has ? "Yes" : "No" };
  }
  const def = METRICS[item.metric];
  const v = candidateValue(def, c);
  return {
    item,
    label,
    target,
    status: v === null ? "unknown" : passes(item.op, v, item.threshold) ? "pass" : "fail",
    display: formatMetric(def.unit, v),
  };
}

export function scoreCandidate(c: CoinProfile, checklist: Checklist): ScoreResult {
  const criteria = checklist.items.filter((i) => i.enabled).map((i) => evaluate(i, c));
  const total = criteria.reduce((s, r) => s + r.item.weight, 0);
  const known = criteria.filter((r) => r.status !== "unknown").reduce((s, r) => s + r.item.weight, 0);
  const passed = criteria.filter((r) => r.status === "pass").reduce((s, r) => s + r.item.weight, 0);

  const score = known ? Math.round((passed / known) * 100) : 0;
  const coverage = total ? known / total : 0;
  const severeFlags = c.redFlags.some((f) => f.severity === "high");

  let verdict: ScoreResult["verdict"];
  if (coverage < 0.5) verdict = { label: "Not enough data", tone: "neutral" };
  else if (score >= 75) verdict = severeFlags ? { label: "Strong match, check red flags", tone: "warn" } : { label: "Strong match", tone: "good" };
  else if (score >= 50) verdict = severeFlags ? { label: "Partial match, check red flags", tone: "warn" } : { label: "Partial match", tone: "neutral" };
  else verdict = { label: "Weak match", tone: "bad" };

  return { profile: c, score, coverage, verdict, criteria };
}
