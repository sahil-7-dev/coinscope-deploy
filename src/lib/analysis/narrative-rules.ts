// Narrative (sector) index and phase rules. Pure, so the live Narratives page
// and the backtest build and classify narratives exactly the same way.
//
// A sector's index is the equal-weighted daily return of its biggest coins,
// compared with BTC. Phases, in the order a narrative usually moves through them:
//   Emerging     beating BTC this week while still flat over the month (early turn)
//   Running      ahead of BTC over the month and still gaining
//   Overheated   a big run whose momentum is fading (late stage)
//   Cooling      ahead over the month but giving it back this week
//   Out of favor lagging BTC

import type { DailyBar } from "@/lib/providers/types";
import type { NarrativeAttention, NarrativePhase, NarrativeReading, NarrativeStage } from "@/lib/types";
import { fmtPct, fmtX } from "@/lib/format";

export interface SectorIndex {
  /** Benchmark dates; every array below lines up with these. */
  dates: string[];
  level: number[];
  btc: number[];
  volTrend: (number | null)[];
  breadth7: (number | null)[];
  breadth30: (number | null)[];
  /** Members with a price that day. */
  members: number[];
}

/** Caps one coin's daily move so a single pump (or bad print) can't swing the index. */
const MAX_DAILY_MOVE = 0.5;
/** Fewer members than this and the index is one or two coins, not a narrative. */
export const MIN_MEMBERS = 3;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function buildSectorIndex(memberBars: DailyBar[][], btcBars: DailyBar[]): SectorIndex {
  const dates = btcBars.map((b) => b.date);
  const pos = new Map(dates.map((d, i) => [d, i]));
  const n = dates.length;
  // Aligned closes/volumes per member; NaN where the coin had no bar (not listed yet, or delisted).
  const closes = memberBars.map((bars) => {
    const row = new Array<number>(n).fill(NaN);
    for (const b of bars) {
      const i = pos.get(b.date);
      if (i !== undefined) row[i] = b.close;
    }
    return row;
  });
  const vols = memberBars.map((bars) => {
    const row = new Array<number>(n).fill(NaN);
    for (const b of bars) {
      const i = pos.get(b.date);
      if (i !== undefined) row[i] = b.volume;
    }
    return row;
  });

  const level = new Array<number>(n).fill(1);
  const volTrend: (number | null)[] = new Array(n).fill(null);
  const breadth7: (number | null)[] = new Array(n).fill(null);
  const breadth30: (number | null)[] = new Array(n).fill(null);
  const members = new Array<number>(n).fill(0);

  const btc = btcBars.map((b) => b.close);
  /** Share of members beating BTC over k days (in a falling market "share that rose" is always near zero). */
  const share = (t: number, k: number) => {
    if (t < k) return null;
    const bench = btc[t] / btc[t - k];
    let ahead = 0;
    let known = 0;
    for (const c of closes) {
      if (!(c[t] > 0) || !(c[t - k] > 0)) continue;
      known++;
      if (c[t] / c[t - k] > bench) ahead++;
    }
    return known >= MIN_MEMBERS ? ahead / known : null;
  };
  const windowMean = (v: number[], from: number, to: number) => {
    let sum = 0;
    for (let i = from; i <= to; i++) {
      if (!(v[i] >= 0)) return null;
      sum += v[i];
    }
    return sum / (to - from + 1);
  };

  for (let t = 0; t < n; t++) {
    members[t] = closes.filter((c) => c[t] > 0).length;
    if (t > 0) {
      const rets = closes.filter((c) => c[t] > 0 && c[t - 1] > 0).map((c) => Math.max(-MAX_DAILY_MOVE, Math.min(MAX_DAILY_MOVE, c[t] / c[t - 1] - 1)));
      level[t] = level[t - 1] * (rets.length ? 1 + mean(rets) : 1);
    }
    breadth7[t] = share(t, 7);
    breadth30[t] = share(t, 30);
    if (t >= 36) {
      const ratios = vols.flatMap((v) => {
        const recent = windowMean(v, t - 6, t);
        const prior = windowMean(v, t - 36, t - 7);
        return recent !== null && prior ? [recent / prior] : [];
      });
      volTrend[t] = ratios.length >= MIN_MEMBERS ? median(ratios) : null;
    }
  }
  return { dates, level, btc, volTrend, breadth7, breadth30, members };
}

export function readingAt(idx: SectorIndex, t: number): NarrativeReading {
  const ok = idx.members[t] >= MIN_MEMBERS;
  const rel = (k: number) => (ok && t >= k ? idx.level[t] / idx.level[t - k] - idx.btc[t] / idx.btc[t - k] : null);
  return { rel7: rel(7), rel30: rel(30), rel90: rel(90), volTrend: idx.volTrend[t], breadth7: idx.breadth7[t], breadth30: idx.breadth30[t] };
}

const HOT_30D = 0.35;
const HOT_90D = 0.8;
const AHEAD_30D = 0.08;
const TURN_7D = 0.03;
const SLIP_7D = -0.03;

export function classify(r: NarrativeReading): NarrativePhase | null {
  const { rel7, rel30 } = r;
  if (rel7 === null || rel30 === null) return null;
  const hot = rel30 >= HOT_30D || (r.rel90 ?? 0) >= HOT_90D;
  if (hot && rel7 < rel30 / 4) return "Overheated";
  if (rel30 > AHEAD_30D) return rel7 > SLIP_7D ? "Running" : "Cooling";
  if (rel7 >= TURN_7D) return "Emerging";
  return rel30 > 0 && rel7 <= SLIP_7D ? "Cooling" : "Out of favor";
}

export function narrativeSignals(phase: NarrativePhase, r: NarrativeReading): string[] {
  const out: string[] = [];
  const pctOf = (v: number | null) => fmtPct(v, { signed: false, digits: 0 });
  if (phase === "Emerging") out.push(`Beating BTC by ${fmtPct(r.rel7)} this week while ${fmtPct(r.rel30)} over 30 days: an early turn.`);
  if (phase === "Running") out.push(`Ahead of BTC by ${fmtPct(r.rel30)} over 30 days and still gaining this week.`);
  if (phase === "Overheated") out.push(`Up ${fmtPct(Math.max(r.rel30 ?? 0, r.rel90 ?? 0))} vs BTC and momentum is fading: late stage, chasing is risky.`);
  if (phase === "Cooling") out.push(`Gave back ${pctOf(Math.abs(r.rel7 ?? 0))} vs BTC this week after running ahead.`);
  if (phase === "Out of favor") out.push(`Lagging BTC by ${pctOf(Math.abs(r.rel30 ?? 0))} over 30 days.`);
  if ((r.volTrend ?? 0) >= 1.3) out.push(`Volume across its coins is ${fmtX(r.volTrend)} last month's level: money is arriving.`);
  else if (phase === "Emerging" && r.volTrend !== null && r.volTrend < 1.1) out.push("Volume hasn't picked up yet, so the turn is unconfirmed.");
  if ((r.breadth7 ?? 0) >= 0.7) out.push(`${pctOf(r.breadth7)} of its coins beat BTC this week: a broad move, not one coin.`);
  else if (phase !== "Out of favor" && r.breadth30 !== null && r.breadth30 <= 0.3) out.push(`Only ${pctOf(r.breadth30)} of its coins beat BTC over 30 days: a few coins carry it.`);
  return out;
}

/** A new phase must hold this many days in a row before it replaces the current one. */
const CONFIRM_DAYS = 3;

/**
 * Phase for every day of the index (null where there's too little data),
 * smoothed so one noisy day doesn't flip it. Uses only past days, so it's
 * safe to backtest.
 */
export function phaseSeries(idx: SectorIndex): (NarrativePhase | null)[] {
  return smooth(idx.dates.map((_, t) => classify(readingAt(idx, t))));
}

/**
 * Stages move on 30/90-day fee windows that hover around thresholds, so they need a longer hold.
 * The stage check (stage-check.ts) replayed 2021–2026: at 5 days a narrative changed stage ~7 times
 * a year and 60% of new stages reversed within a month; at 20 days ~3 times a year and 12% reversed,
 * with early-stage results no worse in either period. Chosen for stability, which suits 1–6 month holds.
 */
export const STAGE_CONFIRM_DAYS = 20;

/** A label switches only after the new one holds `days` in a row. Uses only past days. */
export function smooth<T>(raw: (T | null)[], days = CONFIRM_DAYS): (T | null)[] {
  const out: (T | null)[] = [];
  raw.forEach((p, t) => {
    const prev = out[t - 1] ?? null;
    const held = t >= days - 1 && raw.slice(t - days + 1, t + 1).every((x) => x === p);
    out.push(prev === null || p === null || held ? p : prev);
  });
  return out;
}

/** First day of the phase the series ends in. */
export function phaseSince<T>(dates: string[], phases: (T | null)[]): string | null {
  let t = phases.length - 1;
  const current = phases[t];
  if (!current) return null;
  while (t > 0 && phases[t - 1] === current) t--;
  return dates[t];
}

// ---- Stage (fundamentals only) and attention (market context) ----
//
// The stage says how a narrative's fundamentals are moving, relative to the
// whole market's, and never uses price:
//   Emerging      fees just started beating the market (30 days), or builders are arriving before fees
//   Accelerating  fees beating the market on both 30 and 90 days
//   Maturing      a strong quarter, but the last month slowed
//   Quiet         no fundamental signal either way
//   Fading        fees shrinking against the market
//
// Attention says how much the market has noticed, from price vs BTC only. It's
// shown next to the stage as context and never enters a fundamental score:
//   Unnoticed / Noticed / Crowded

/** Fee growth across a narrative's coins (medians), and how many of them earn fees. */
export interface NarrativeFundamentals {
  feeGrowth30d: number | null;
  feeGrowth90d: number | null;
  withFees: number;
  /** Members whose 90-day fees grew. */
  growing: number;
}

/** Median fee growth across every tracked coin: the market-wide tide that a narrative is measured against. */
export interface MarketFees {
  g30: number | null;
  g90: number | null;
}

/** New protocols launched in the categories (and on the chains) a narrative's coins operate in. */
export interface NarrativeBuilders {
  last90: number;
  prev90: number;
}

/** Launches across all of DefiLlama in the same windows: DefiLlama's own listing pace rises and falls, so builders are measured against it. */
export type MarketLaunches = NarrativeBuilders;

export function marketFees(members: { g30: number | null; g90: number | null }[]): MarketFees {
  const g30 = members.flatMap((m) => (m.g30 === null ? [] : [m.g30]));
  const g90 = members.flatMap((m) => (m.g90 === null ? [] : [m.g90]));
  return { g30: g30.length ? median(g30) : null, g90: g90.length ? median(g90) : null };
}

/** Fewer coins with fee data than this and the stage relies on builders only. */
export const MIN_FEE_MEMBERS = 2;
const FEES_UP = 0.15;
const FEES_DOWN = -0.2;
/** Builders count as "arriving" at 1.3× the prior 90 days' launches, with at least this many. */
const BUILDERS_MIN = 5;
const BUILDERS_UP = 1.3;

/** 30- and 90-day fee growth with `end` as the last day counted (null when there isn't enough history). */
export function feeGrowthAt(values: number[], end: number): { g30: number | null; g90: number | null } {
  const sum = (from: number, to: number) => {
    let s = 0;
    for (let i = from; i <= to; i++) s += values[i];
    return s;
  };
  const g = (days: number) => {
    if (end - 2 * days + 1 < 0) return null;
    const prev = sum(end - 2 * days + 1, end - days);
    return prev > 0 ? sum(end - days + 1, end) / prev - 1 : null;
  };
  return { g30: g(30), g90: g(90) };
}

/**
 * Fee growth on any day from a daily series, with the day before as the last
 * one counted (what was known that morning). Same numbers as feeGrowthAt, but
 * with running sums so replaying years of days stays fast.
 */
export function feeGrowthLookup(series: { dates: string[]; values: number[] }): (date: string) => { g30: number | null; g90: number | null } {
  const pos = new Map(series.dates.map((d, i) => [d, i]));
  const prefix = [0];
  for (const v of series.values) prefix.push(prefix[prefix.length - 1] + v);
  const sum = (from: number, to: number) => prefix[to + 1] - prefix[from];
  const g = (end: number, days: number) => {
    if (end - 2 * days + 1 < 0) return null;
    const prev = sum(end - 2 * days + 1, end - days);
    return prev > 0 ? sum(end - days + 1, end) / prev - 1 : null;
  };
  return (date) => {
    const end = pos.get(new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
    return end === undefined ? { g30: null, g90: null } : { g30: g(end, 30), g90: g(end, 90) };
  };
}

export function summarizeFees(members: { g30: number | null; g90: number | null }[]): NarrativeFundamentals {
  const g30 = members.flatMap((m) => (m.g30 === null ? [] : [m.g30]));
  const g90 = members.flatMap((m) => (m.g90 === null ? [] : [m.g90]));
  const withFees = Math.max(g30.length, g90.length);
  return {
    feeGrowth30d: g30.length >= MIN_FEE_MEMBERS ? median(g30) : null,
    feeGrowth90d: g90.length >= MIN_FEE_MEMBERS ? median(g90) : null,
    withFees,
    growing: g90.filter((g) => g > 0).length,
  };
}

/** Launch timestamps (seconds) between `from` (exclusive) and `to` (inclusive), from a sorted list. */
export function countBetween(sorted: number[], from: number, to: number): number {
  const firstAfter = (t: number) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return firstAfter(to) - firstAfter(from);
}

function buildersArriving(b: NarrativeBuilders | null, market: MarketLaunches | null): boolean {
  if (!b || b.last90 < BUILDERS_MIN) return false;
  const marketPace = market && market.prev90 > 0 ? market.last90 / market.prev90 : 1;
  return b.last90 / Math.max(b.prev90, BUILDERS_MIN) >= BUILDERS_UP * marketPace;
}

/** Fundamentals-only stage. Fee growth is measured against the market's (a crash or a bull run lifts fees everywhere). */
export function narrativeStage(f: NarrativeFundamentals, market: MarketFees, builders: NarrativeBuilders | null, launches: MarketLaunches | null): NarrativeStage {
  const vs = (g: number | null, m: number | null) => (g === null ? null : g - (m ?? 0));
  const ex30 = vs(f.feeGrowth30d, market.g30);
  const ex90 = vs(f.feeGrowth90d, market.g90);
  const up30 = (ex30 ?? -1) >= FEES_UP;
  const up90 = (ex90 ?? -1) >= FEES_UP;
  if (up30 && up90) return "Accelerating";
  if (up30 && (ex90 ?? 0) > -0.1) return "Emerging";
  if (up90) return (ex30 ?? 0) <= 0 ? "Maturing" : "Accelerating";
  if ((ex90 ?? 0) <= FEES_DOWN && (ex30 ?? 0) <= 0 && (ex30 !== null || ex90 !== null)) return "Fading";
  // Builders often arrive before usage shows up in fees.
  if (buildersArriving(builders, launches)) return "Emerging";
  return "Quiet";
}

/** How much the market has noticed a narrative, from price vs BTC (and trending, when known). Context only. */
export function narrativeAttention(phase: NarrativePhase | null, r: NarrativeReading, trending = false): NarrativeAttention {
  if (phase === "Overheated" || (r.rel90 ?? 0) >= HOT_90D || (r.rel30 ?? 0) >= HOT_30D) return "Crowded";
  if (trending || phase === "Running" || (r.rel30 ?? 0) >= AHEAD_30D || (r.rel90 ?? 0) >= 0.4) return "Noticed";
  return "Unnoticed";
}

/**
 * 0–100: how good the narrative's fundamental backdrop is for an entry.
 * Sustained growth ranks above a fresh one-month turn: in the 2021–2026
 * backtest, accelerating narratives did best and emerging ones (often a blip,
 * or builders without usage yet) did worse than quiet ones.
 */
export const STAGE_STRENGTH: Record<NarrativeStage, number> = {
  Accelerating: 85,
  Emerging: 70,
  Quiet: 55,
  Maturing: 45,
  Fading: 25,
};

export function stageSignals(stage: NarrativeStage, f: NarrativeFundamentals, builders: NarrativeBuilders | null, launches: MarketLaunches | null, mentions: number | null): string[] {
  const out: string[] = [];
  if (f.feeGrowth90d !== null || f.feeGrowth30d !== null) {
    const windows = [
      f.feeGrowth90d !== null && `${fmtPct(f.feeGrowth90d)} over 90 days`,
      f.feeGrowth30d !== null && `${fmtPct(f.feeGrowth30d)} over 30 days`,
    ].filter(Boolean);
    out.push(`Fees across its ${f.withFees} fee-earning coins: ${windows.join(", ")} (median); ${f.growing} of ${f.withFees} growing over 90 days.`);
  } else out.push("Too few of its coins have fee data, so its stage rests on builders only.");
  if (builders && builders.last90 + builders.prev90 > 0) {
    const own = builders.prev90 > 0 ? `, ${fmtX(builders.last90 / builders.prev90)}` : "";
    const all = launches && launches.prev90 > 0 ? `; all of DefiLlama: ${fmtX(launches.last90 / launches.prev90)}` : "";
    out.push(
      `${builders.last90} new protocols in its coins' categories in 90 days (${builders.prev90} the 90 before${own}${all})${buildersArriving(builders, launches) ? ": builders are arriving faster than elsewhere" : ""}.`,
    );
  }
  if (stage === "Emerging") out.push("Fundamentals just started improving faster than the market's: the early window.");
  if (stage === "Accelerating") out.push("Fundamentals have been beating the market for a quarter and still are.");
  if (stage === "Maturing") out.push("A strong quarter, but growth slowed this month.");
  if (mentions) out.push(`Mentioned in ${mentions} recent headline${mentions === 1 ? "" : "s"}.`);
  return out;
}
