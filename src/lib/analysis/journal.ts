// Decision journal: how your buys and passes did against BTC, and whether the
// app's verdict at the time was right. Pure, so it's tested without a database.

import type { Decision, DecisionResult, JournalGroup, JournalResponse, NarrativeStage } from "@/lib/types";

/** Decisions younger than this aren't counted: a few days' move says nothing about a 1–6 month hold. */
export const MIN_DAYS = 30;
const DAY_MS = 86_400_000;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** Logged more than a day after the decision, so the stored verdict isn't what the app said on the day. */
export const isLoggedLate = (d: Pick<Decision, "decidedOn" | "createdAt">) => daysBetween(d.decidedOn, d.createdAt.slice(0, 10)) > 1;

/** One decision's result: since the decision until it was sold, or until today. */
export function decisionResult(d: Decision, now: { price: number | null; btcPrice: number | null }, today: string, minDays = MIN_DAYS): DecisionResult {
  const closed = d.closedOn !== null && d.closePrice !== null && d.closeBtcPrice !== null;
  const endPrice = closed ? d.closePrice : now.price;
  const endBtcPrice = closed ? d.closeBtcPrice : now.btcPrice;
  const days = Math.max(0, daysBetween(d.decidedOn, closed ? (d.closedOn as string) : today));
  const ret = endPrice !== null && d.price > 0 ? endPrice / d.price - 1 : null;
  const btcRet = endBtcPrice !== null && d.btcPrice > 0 ? endBtcPrice / d.btcPrice - 1 : null;
  return {
    ...d,
    loggedLate: isLoggedLate(d),
    endPrice,
    endBtcPrice,
    days,
    return: ret,
    btcReturn: btcRet,
    vsBtc: ret !== null && btcRet !== null ? (1 + ret) / (1 + btcRet) - 1 : null,
    counted: days >= minDays && ret !== null && btcRet !== null,
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function group(label: string, list: DecisionResult[]): JournalGroup {
  const vs = list.flatMap((r) => (r.vsBtc === null ? [] : [r.vsBtc]));
  return { label, decisions: vs.length, vsBtc: median(vs), beatBtc: vs.length ? vs.filter((x) => x > 0).length / vs.length : null };
}

const VERDICTS: [Decision["verdict"], string][] = [
  ["strong", "Strong candidate"],
  ["watch", "Watchlist"],
  ["speculative", "Speculative"],
  ["avoid", "Avoid"],
];
const STAGES: NarrativeStage[] = ["Emerging", "Accelerating", "Quiet", "Maturing", "Fading"];

export function journalSummary(results: DecisionResult[], minDays = MIN_DAYS): JournalResponse["summary"] {
  const counted = results.filter((r) => r.counted);
  // What the app said only counts when it was recorded on the day.
  const onTime = counted.filter((r) => !r.loggedLate);
  return {
    buys: group("Your buys", counted.filter((r) => r.action === "buy")),
    passes: group("Your passes", counted.filter((r) => r.action === "pass")),
    against: group(
      "Against the app",
      onTime.filter((r) => (r.action === "buy" && (r.verdict === "speculative" || r.verdict === "avoid")) || (r.action === "pass" && r.verdict === "strong")),
    ),
    byVerdict: VERDICTS.map(([kind, label]) => group(label, onTime.filter((r) => r.verdict === kind))),
    byStage: [...STAGES.map((s) => group(s, onTime.filter((r) => r.stage === s))), group("No tracked narrative", onTime.filter((r) => r.stage === null))],
    tooEarly: results.filter((r) => !r.counted && r.days < minDays).length,
  };
}
