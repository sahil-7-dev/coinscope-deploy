// Does the narrative stage work? Replays every narrative's stage over its whole
// history (from data known on each day), then asks two questions:
//   1. Stability: how often does the stage change, and how often does a new
//      stage reverse within a month?
//   2. Results: after a narrative entered a stage, did its coins beat BTC and
//      the other narratives over the next 30 / 90 / 180 days?
// Pure, so it can be tested and tried with other confirmation lengths.

import type { NarrativeStage, StageCall, StageCallStats, StageValidation } from "@/lib/types";
import { MIN_MEMBERS, smooth, STAGE_CONFIRM_DAYS } from "./narrative-rules";

/** One narrative's raw (unsmoothed) daily stage next to its index and BTC, on the same dates. */
export interface StageTrack {
  id: string;
  name: string;
  dates: string[];
  /** Null where there was no fee or builder data yet. */
  stages: (NarrativeStage | null)[];
  level: number[];
  btc: number[];
  /** Index members with a price that day. */
  members: number[];
}

export const HORIZONS = [30, 90, 180] as const;
/** A new stage that changes again within this many days counts as reversed. */
export const REVERSAL_DAYS = 30;
/** Confirmation lengths compared with the current one. */
export const CONFIRM_VARIANTS = [1, 5, 10, 15, 20, 30];
const SPLIT = "2024-01-01";
const STAGES: NarrativeStage[] = ["Emerging", "Accelerating", "Quiet", "Maturing", "Fading"];
const EARLY: NarrativeStage[] = ["Emerging", "Accelerating"];

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const share = (xs: number[], test: (x: number) => boolean) => (xs.length ? xs.filter(test).length / xs.length : null);
/** Share above zero, counting exact ties as half (narratives that share coins often tie with the median). */
const beatShare = (xs: number[]) => (xs.length ? xs.reduce((n, x) => n + (x > 1e-12 ? 1 : Math.abs(x) <= 1e-12 ? 0.5 : 0), 0) / xs.length : null);
const nums = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);

/** Lengths of stages that have ended. */
const finishedDays = (calls: StageCall[]) => calls.filter((c) => !c.ongoing).map((c) => c.days);
/** Share of new stages that changed again within a month (ongoing ones count once they've lasted that long). */
function reversedShare(calls: StageCall[]): number | null {
  const judged = calls.filter((c) => !c.ongoing || c.days >= REVERSAL_DAYS);
  return share(judged.map((c) => (!c.ongoing && c.days < REVERSAL_DAYS ? 1 : 0)), (x) => x === 1);
}

/** The index's return over `h` days from day t, relative to BTC's (null without enough members or future). */
export function forwardVsBtc(tr: Pick<StageTrack, "level" | "btc" | "members">, t: number, h: number): number | null {
  const e = t + h;
  if (e >= tr.level.length || tr.members[t] < MIN_MEMBERS || tr.members[e] < MIN_MEMBERS) return null;
  return tr.level[e] / tr.level[t] / (tr.btc[e] / tr.btc[t]) - 1;
}

/**
 * The typical (median) forward result of every narrative starting on each day,
 * so a call is judged against the other narratives over the same days (a bull
 * run lifts all of them). Median, not mean: a few huge runs would otherwise
 * make almost every narrative look "behind".
 */
export function crossMedian(tracks: StageTrack[], h: number): (number | null)[] {
  const n = tracks[0]?.dates.length ?? 0;
  return Array.from({ length: n }, (_, t) => median(nums(tracks.map((tr) => forwardVsBtc(tr, t, h)))));
}

/** Every day the confirmed stage changed, with how long it lasted and what came next. */
export function stageCalls(tr: StageTrack, confirmDays: number, averages: Record<number, (number | null)[]>): StageCall[] {
  const stages = smooth(tr.stages, confirmDays);
  const calls: StageCall[] = [];
  for (let t = 1; t < stages.length; t++) {
    const to = stages[t];
    const from = stages[t - 1];
    if (!to || to === from) continue;
    let end = t;
    while (end + 1 < stages.length && stages[end + 1] === to) end++;
    const ongoing = end === stages.length - 1;
    const fwd = (h: number) => forwardVsBtc(tr, t, h);
    const vsOthers = (h: number) => {
      const f = fwd(h);
      const avg = averages[h]?.[t] ?? null;
      return f === null || avg === null ? null : f - avg;
    };
    calls.push({
      date: tr.dates[t],
      from,
      to,
      days: end - t + 1,
      ongoing,
      vsBtc30: fwd(30),
      vsBtc90: fwd(90),
      vsBtc180: fwd(180),
      vsOthers90: vsOthers(90),
    });
  }
  return calls;
}

function statsFor(stage: NarrativeStage, calls: StageCall[], dayResults: number[]): StageCallStats {
  const mine = calls.filter((c) => c.to === stage);
  const v90 = nums(mine.map((c) => c.vsBtc90));
  const o90 = nums(mine.map((c) => c.vsOthers90));
  return {
    stage,
    calls: mine.length,
    measured: o90.length,
    vsBtc30: median(nums(mine.map((c) => c.vsBtc30))),
    vsBtc90: median(v90),
    vsBtc180: median(nums(mine.map((c) => c.vsBtc180))),
    beatBtc90: share(v90, (x) => x > 0),
    vsOthers90: median(o90),
    vsOthers90Mean: mean(o90),
    beatOthers90: beatShare(o90),
    everyDayVsOthers90: median(dayResults),
    medianDays: median(finishedDays(mine)),
    reversed: reversedShare(mine),
  };
}

const yearsOf = (tracks: StageTrack[]) => tracks.reduce((sum, tr) => sum + tr.stages.filter((s) => s !== null).length, 0) / 365;

/** How one confirmation length behaves: stability, and how early-stage calls did. */
function variant(tracks: StageTrack[], days: number, averages: Record<number, (number | null)[]>) {
  const all = tracks.flatMap((tr) => stageCalls(tr, days, averages));
  const early = all.filter((c) => EARLY.includes(c.to));
  const earlyIn = (test: (d: string) => boolean) => median(nums(early.filter((c) => test(c.date)).map((c) => c.vsOthers90)));
  const o90 = nums(early.map((c) => c.vsOthers90));
  return {
    days,
    calls: all.length,
    changesPerYear: all.length / Math.max(yearsOf(tracks), 1e-9),
    medianDays: median(finishedDays(all)),
    reversed: reversedShare(all),
    earlyCalls: o90.length,
    earlyVsOthers90: median(o90),
    earlyBeatOthers90: beatShare(o90),
    earlyBefore: earlyIn((d) => d < SPLIT),
    earlyFrom: earlyIn((d) => d >= SPLIT),
  };
}

export function checkStages(tracks: StageTrack[], confirmDays = STAGE_CONFIRM_DAYS): Omit<StageValidation, "updatedAt" | "notes"> {
  const averages = Object.fromEntries(HORIZONS.map((h) => [h, crossMedian(tracks, h)])) as Record<number, (number | null)[]>;
  const perTrack = tracks.map((tr) => ({ tr, calls: stageCalls(tr, confirmDays, averages) }));
  const calls = perTrack.flatMap((p) => p.calls);

  // Every day spent in a stage (not just the day it started), vs the other narratives over the next 90 days.
  const days = new Map<NarrativeStage, number[]>(STAGES.map((s) => [s, []]));
  for (const tr of tracks) {
    const stages = smooth(tr.stages, confirmDays);
    stages.forEach((s, t) => {
      const f = forwardVsBtc(tr, t, 90);
      const avg = averages[90][t];
      if (s && f !== null && avg !== null) days.get(s)?.push(f - avg);
    });
  }

  const known = tracks.flatMap((tr) => tr.dates.filter((_, t) => tr.stages[t] !== null));
  const sorted = [...known].sort();
  const period = (label: string, test: (d: string) => boolean) => ({
    label,
    stages: STAGES.map((stage) => {
      const o90 = nums(calls.filter((c) => c.to === stage && test(c.date)).map((c) => c.vsOthers90));
      return { stage, calls: o90.length, vsOthers90: median(o90), beatOthers90: beatShare(o90) };
    }),
  });

  return {
    from: sorted[0] ?? null,
    to: sorted[sorted.length - 1] ?? null,
    narratives: tracks.length,
    narrativeYears: yearsOf(tracks),
    confirmDays,
    stages: STAGES.map((s) => statsFor(s, calls, days.get(s) ?? [])),
    periods: [period(`Before ${SPLIT.slice(0, 4)}`, (d) => d < SPLIT), period(`From ${SPLIT.slice(0, 4)}`, (d) => d >= SPLIT)],
    variants: CONFIRM_VARIANTS.map((d) => variant(tracks, d, averages)),
    tracks: perTrack.map(({ tr, calls: c }) => ({
      id: tr.id,
      name: tr.name,
      years: tr.stages.filter((s) => s !== null).length / 365,
      changesPerYear: c.length / Math.max(tr.stages.filter((s) => s !== null).length / 365, 1e-9),
      calls: c,
    })),
  };
}

/** Early-stage edge needed in both periods before the stage counts as a signal. */
const SIGNAL_EDGE = 0.02;

/** The check's conclusion in plain words. Requires the same result before and after 2024, so one lucky period isn't enough. */
export function stageFinding(v: Pick<StageValidation, "variants" | "confirmDays" | "periods">): { tone: "good" | "warn" | "neutral"; text: string; stability: string } {
  const cur = v.variants.find((x) => x.days === v.confirmDays);
  const fading = v.periods.map((p) => p.stages.find((s) => s.stage === "Fading")?.vsOthers90 ?? null);
  const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);
  const stability = cur
    ? `Each narrative changes stage about ${cur.changesPerYear.toFixed(1)} times a year; ${pct(cur.reversed)} of new stages reverse within a month; a stage lasts ${cur.medianDays ?? "—"} days (median).`
    : "";
  if (cur && cur.earlyBefore !== null && cur.earlyFrom !== null && cur.earlyBefore >= SIGNAL_EDGE && cur.earlyFrom >= SIGNAL_EDGE)
    return { tone: "good", text: "Narratives entering Emerging or Accelerating went on to beat the typical narrative over 90 days, before and after 2024.", stability };
  if (fading.length > 0 && fading.every((x) => x !== null && x <= -SIGNAL_EDGE))
    return { tone: "neutral", text: "Fading narratives lagged the typical narrative in both periods, so Fading is a useful warning. No stage reliably picked the winners.", stability };
  return {
    tone: "warn",
    text: "No stage reliably picked the narratives that did better over the next 90 days. Use the stage to describe how fundamentals are moving, not as a buy or sell signal on its own.",
    stability,
  };
}
