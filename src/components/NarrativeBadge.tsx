import type { CoinNarrative, NarrativeAttention, NarrativePhase, NarrativeStage, NarrativeStat, Tone } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import { Badge } from "./ui";

/** "since Mar 4", or "for over a year" when the stage fills the whole year of history (its real start is earlier). */
export function stageSinceLabel(s: Pick<NarrativeStat, "stageSince" | "stageHistory">): string | null {
  if (!s.stageSince) return null;
  return s.stageHistory[0]?.date === s.stageSince ? "for over a year" : `since ${fmtDate(s.stageSince)}`;
}

/** Market phase: how a narrative's coins move against BTC (context, not a signal). */
export const PHASES: Record<NarrativePhase, { tone: Tone; color: string; meaning: string }> = {
  Emerging: { tone: "good", color: "#3b82f6", meaning: "Beating BTC this week while still flat over the month." },
  Running: { tone: "good", color: "#16a34a", meaning: "Ahead of BTC over the month and still gaining." },
  Overheated: { tone: "warn", color: "#f59e0b", meaning: "Ran hard and momentum is fading." },
  Cooling: { tone: "warn", color: "#f97316", meaning: "Was ahead of BTC, giving it back this week." },
  "Out of favor": { tone: "bad", color: "#ea3943", meaning: "Lagging BTC." },
};

export const PHASE_ORDER: NarrativePhase[] = ["Emerging", "Running", "Overheated", "Cooling", "Out of favor"];

/** Stage: fundamentals only (fees vs the market's, builders arriving). */
export const STAGES: Record<NarrativeStage, { tone: Tone; color: string; meaning: string }> = {
  Emerging: { tone: "good", color: "#3b82f6", meaning: "Fees just started beating the market's, or builders are arriving before fees: the early window." },
  Accelerating: { tone: "good", color: "#16a34a", meaning: "Fees have beaten the market's for a quarter and still are." },
  Quiet: { tone: "neutral", color: "#64748b", meaning: "No fundamental signal either way." },
  Maturing: { tone: "warn", color: "#f59e0b", meaning: "A strong quarter, but growth slowed this month." },
  Fading: { tone: "bad", color: "#ea3943", meaning: "Fees shrinking against the market." },
};

export const STAGE_ORDER: NarrativeStage[] = ["Emerging", "Accelerating", "Quiet", "Maturing", "Fading"];

/** Attention: how much the market has noticed (price vs BTC). Context only, never in a score. */
export const ATTENTION: Record<NarrativeAttention, { tone: Tone; meaning: string }> = {
  Unnoticed: { tone: "good", meaning: "Prices haven't moved ahead of BTC: the market hasn't noticed yet." },
  Noticed: { tone: "neutral", meaning: "Ahead of BTC or trending: the market is paying attention." },
  Crowded: { tone: "warn", meaning: "Ran hard against BTC: expectations are high, late entries often buy the top." },
};

export function PhaseBadge({ phase }: { phase: NarrativePhase | null }) {
  return phase ? <Badge tone={PHASES[phase].tone}>{phase}</Badge> : <span className="text-xs text-subtle">—</span>;
}

export function StageBadge({ stage }: { stage: NarrativeStage | null | undefined }) {
  return stage && STAGES[stage] ? <Badge tone={STAGES[stage].tone}>{stage}</Badge> : <span className="text-xs text-subtle">—</span>;
}

export function AttentionBadge({ attention }: { attention: NarrativeAttention | null | undefined }) {
  if (!attention || !ATTENTION[attention]) return <span className="text-xs text-subtle">—</span>;
  return (
    <span title={`Market attention (context, not scored): ${ATTENTION[attention].meaning}`} className="text-xs">
      <Badge tone={ATTENTION[attention].tone}>{attention}</Badge>
    </span>
  );
}

/** "Privacy · Emerging · Unnoticed" for a coin. */
export function CoinNarrativeChip({ narrative, loaded }: { narrative: CoinNarrative | null | undefined; loaded?: boolean }) {
  if (!narrative?.stage || !STAGES[narrative.stage]) {
    return <span className="text-xs text-subtle">{loaded === false ? "Narratives not loaded" : "No tracked narrative"}</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-muted" title={STAGES[narrative.stage].meaning}>
      <span className="text-fg-2">{narrative.sector}</span>
      <StageBadge stage={narrative.stage} />
      <AttentionBadge attention={narrative.attention} />
    </span>
  );
}
