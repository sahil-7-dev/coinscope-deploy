// A plain-language verdict for one coin, for a fundamentals-first investor who
// wants coins with real usage riding an early or accelerating narrative:
//   Strong candidate  solid fundamentals, backed by evidence, in a good narrative
//   Watchlist         decent, but something's missing (listed under "would improve if")
//   Speculative       the story is ahead of the evidence (good narrative, weak or unproven fundamentals)
//   Avoid             weak fundamentals, serious red flags or extreme risk
// No technical analysis. Price only appears as valuation context and in the risk score.
// Pure and client-safe; every threshold is in VERDICT_RULES.

import type { CoinProfile, CoinResearch, NarrativeStage, Tone } from "@/lib/types";
import { fmtPct } from "@/lib/format";
import { feesExpected } from "./categories";
import { fundamentalsFor, type FundamentalScore } from "./fundamentals";
import { assumptionLabel, thesisStatus, type ThesisStatus } from "./thesis";

export type VerdictKind = "strong" | "watch" | "speculative" | "avoid";

export interface Verdict {
  kind: VerdictKind;
  label: string;
  tone: Tone;
  summary: string;
  reasons: { tone: Tone; text: string }[];
  /** What would have to change for a better verdict. */
  changeIf: string[];
  fundamentals: FundamentalScore;
  /** Your thesis checks, when you've written any. */
  thesis: ThesisStatus | null;
}

/** Best fundamental match to the user's benchmark coins, if any were compared. */
export interface MatchInfo {
  score: number;
  reference: string;
}

export const VERDICT_RULES = {
  faStrong: 65,
  faWatch: 50,
  faAvoid: 35,
  /** Share of the scorecard backed by data or your ratings needed for a strong verdict. */
  confidenceStrong: 0.5,
  confidenceLow: 0.35,
  valuationMin: 40,
  riskMax: 70,
  riskAvoid: 80,
  matchMin: 50,
};

const R = VERDICT_RULES;
// In the 2021–2026 backtest, coins in Accelerating narratives did best (+2.8%) and Quiet ones beat the average,
// while Emerging (builders arriving, fees not yet beating the market) did worse than Fading (−4.8% vs −2.2%).
/** Stages that don't block a strong verdict: fees accelerating, or quiet (strong fundamentals before the crowd notices). */
const GOOD_STAGES: NarrativeStage[] = ["Accelerating", "Quiet"];
/** The only stage that keeps weak or unmeasured fundamentals out of Avoid: the narrative's fees are already growing. */
const RESCUE_STAGES: NarrativeStage[] = ["Accelerating"];
/** A story the market can bet on before the evidence: makes a weak-evidence coin Speculative rather than Watchlist. */
const STORY_STAGES: NarrativeStage[] = ["Emerging", "Accelerating"];

const META: Record<VerdictKind, [string, Tone]> = {
  strong: ["Strong candidate", "good"],
  watch: ["Watchlist", "neutral"],
  speculative: ["Speculative", "warn"],
  avoid: ["Avoid", "bad"],
};

export function verdictFor(p: CoinProfile, opts: { match?: MatchInfo | null; research?: CoinResearch | null } = {}): Verdict {
  const fa = fundamentalsFor(p, opts.research);
  const score = fa.score;
  const risk = p.scores.risk.score;
  const n = p.narrative?.stage ? p.narrative : null;
  const cat = (key: string) => fa.categories.find((c) => c.key === key);
  const valuation = cat("valuation");
  const adoption = cat("adoption");
  const highFlags = p.redFlags.filter((x) => x.severity === "high");
  const match = opts.match ?? null;
  const reasons: Verdict["reasons"] = [];

  // ---- Reasons ----
  if (score !== null) {
    reasons.push({
      tone: score >= R.faStrong ? "good" : score >= R.faWatch ? "neutral" : "bad",
      text: `Fundamental score ${score}/100 (${fa.label.toLowerCase()}), ${fmtPct(fa.confidence, { signed: false, digits: 0 })} of it backed by data or your ratings.`,
    });
  }
  if (score !== null && score >= 70) {
    reasons.push({
      tone: "warn",
      text: "Scores of 70+ were often reached at peak activity and did worse than 50–69 in the 2021–2026 backtest: check the fees aren't a one-off spike.",
    });
  }
  for (const s of fa.strengths.slice(0, 3)) reasons.push({ tone: "good", text: s });
  for (const w of fa.weaknesses.slice(0, 3)) reasons.push({ tone: "bad", text: w });
  if (n) {
    const tone: Tone = n.stage === "Accelerating" ? "good" : n.stage === "Quiet" || n.stage === "Emerging" ? "neutral" : "warn";
    const note = n.stage === "Emerging" ? " Builders are arriving but its fees aren't beating the market yet; coins in Emerging narratives did worse than average in the backtest." : "";
    reasons.push({ tone, text: `Narrative: ${n.sector}'s fundamentals are ${n.stage.toLowerCase()}.${note}` });
    if (n.attention === "Crowded") {
      reasons.push({ tone: "warn", text: `Market context (not fundamentals): ${n.sector} already ran hard against BTC, so expectations are high.` });
    }
  } else {
    reasons.push({ tone: "neutral", text: p.narrativeLoaded ? "Not part of any tracked narrative." : "Narrative data not loaded yet (open the Narratives page once)." });
  }
  // Benchmark fit is research context, not a gate: a good coin doesn't have to look like yesterday's winner.
  if (match) {
    reasons.push({
      tone: match.score >= 65 ? "good" : "neutral",
      text: `Fundamentally ${match.score}% like ${match.reference}${match.score >= R.matchMin ? "" : ": a different profile from your benchmark, so judge it on its own numbers"}.`,
    });
  }
  if (risk !== null) reasons.push({ tone: risk >= R.riskMax ? "bad" : risk >= 45 ? "neutral" : "good", text: `Risk ${risk}/100 (${p.scores.risk.label.toLowerCase()}): volatility, liquidity, dilution and size.` });
  for (const flag of highFlags) reasons.push({ tone: "bad", text: `Red flag: ${flag.title}.` });
  // Privacy, payments, storage, DePIN: fees aren't how these earn, so missing fee data is unknown rather than "no usage".
  const unmeasured = adoption?.evidence === "fallback" && !feesExpected(p.categories ?? []);
  if (unmeasured) reasons.push({ tone: "neutral", text: "Fees aren't how its category earns, so missing fee data counts as unknown, not as weak usage." });
  const thesis = opts.research ? thesisStatus(opts.research, p) : null;
  for (const b of thesis?.broken ?? []) {
    reasons.push({ tone: "bad", text: `Your thesis: “${assumptionLabel(b.assumption)}” no longer holds (${b.rule}; now ${b.current}).` });
  }
  if (thesis?.reviewDue) reasons.push({ tone: "warn", text: `Your review date (${opts.research?.thesis.reviewOn}) has arrived: time to re-check the research.` });

  const make = (kind: VerdictKind, summary: string, changeIf: string[] = []): Verdict => ({
    kind,
    label: META[kind][0],
    tone: META[kind][1],
    summary,
    reasons,
    changeIf,
    fundamentals: fa,
    thesis,
  });

  if (score === null) return make("watch", "Not enough data to judge its fundamentals yet.", ["More fundamentals data becomes available, or you rate it in Your research."]);

  // ---- Avoid ----
  if (highFlags.length) return make("avoid", `Serious red flag: ${highFlags[0].title.toLowerCase()}.`);
  if (risk !== null && risk >= R.riskAvoid) return make("avoid", `Extreme risk (${risk}/100): very volatile, thin or heavily diluted.`);
  if (score < R.faAvoid && !(n && RESCUE_STAGES.includes(n.stage))) return make("avoid", `Weak fundamentals (${score}/100) and no accelerating narrative to make up for it.`);
  // No measurable usage and nothing early about its narrative: listings and tokenomics alone don't make a fundamentals case.
  const noUsage = adoption?.evidence === "fallback" && !unmeasured;
  const believer = (opts.research?.ratings.useCase ?? 0) >= 7;
  if (noUsage && !believer && !(n && RESCUE_STAGES.includes(n.stage))) {
    return make("avoid", "No measurable usage (no fees on DefiLlama) and no accelerating narrative: doesn't fit a fundamentals strategy.", [
      "Usage data appears, its narrative's fees start accelerating, or your research rates its use case 7/10 or higher.",
    ]);
  }

  // ---- What's missing for a strong verdict ----
  const unmet: string[] = [];
  if (score < R.faStrong) unmet.push(`Its fundamental score reaches ${R.faStrong}+ (now ${score}).`);
  if (fa.confidence < R.confidenceStrong) unmet.push(`More of the thesis is backed by evidence (${fmtPct(fa.confidence, { signed: false, digits: 0 })} now): rate it in Your research, or wait for usage data.`);
  if (!n) unmet.push(p.narrativeLoaded ? "It becomes part of an emerging or accelerating narrative." : "Narrative data is loaded (open the Narratives page).");
  else if (!GOOD_STAGES.includes(n.stage)) unmet.push(`Its narrative's fees (${n.sector}) start accelerating (now ${n.stage.toLowerCase()}).`);
  // Market context, kept out of the score: buying into a narrative that already ran is a timing risk.
  if (n?.attention === "Crowded") unmet.push(`${n.sector} cools off after its run (market context, not a fundamental issue).`);
  if (valuation?.score != null && valuation.score < R.valuationMin) unmet.push(`It gets cheaper for its usage (valuation ${valuation.score}/100).`);
  if (risk !== null && risk >= R.riskMax) unmet.push(`Risk drops below ${R.riskMax} (now ${risk}).`);
  // Your own assumptions are rules too: a broken one rules out a strong verdict.
  for (const b of thesis?.broken ?? []) unmet.push(`Your assumption holds again: ${assumptionLabel(b.assumption)}.`);

  if (!unmet.length) {
    const unlike = match && match.score < R.matchMin ? ` Unlike your benchmark (${match.score}% like ${match.reference}), so this isn't a repeat of that pattern.` : "";
    return make(
      "strong",
      (n?.stage === "Quiet"
        ? `Real fundamentals in a narrative (${n.sector}) the market isn't watching yet, at a reasonable valuation. Worth deeper research.`
        : `Real, growing fundamentals in a narrative whose fees are accelerating (${n?.sector}), at a reasonable valuation. Worth deeper research.`) + unlike,
    );
  }
  // The story is ahead of the evidence: a good narrative but weak or unmeasurable usage.
  if ((score < R.faWatch || noUsage || fa.confidence < R.confidenceLow) && n && STORY_STAGES.includes(n.stage)) {
    return make(
      "speculative",
      noUsage ? `Riding the ${n.sector} narrative without measurable usage: a bet on the story, not the fundamentals.` : `The ${n.sector} narrative is ahead of the evidence: fundamentals are ${fa.label.toLowerCase()}.`,
      unmet,
    );
  }
  return make("watch", `Not a strong candidate yet: ${unmet.length} condition${unmet.length === 1 ? "" : "s"} missing.`, unmet);
}
