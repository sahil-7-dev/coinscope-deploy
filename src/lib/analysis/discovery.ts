// Early-discovery test, implemented from docs/early-discovery-methodology.md (v1.0).
// Does a rule flag coins that go on to make big moves (+100% before −50%) more often
// than the other coins on the same dates, in bull and bear markets?
//
// Pure mechanics only: outcomes, discovery events, date-matched baselines, recall,
// bootstrap and the verdict. No I/O, so each part is tested on small synthetic data;
// discovery-backtest.ts feeds it the real history. Section numbers (§) refer to the methodology.

import { findRuns } from "./series";

export const DAY_MS = 86_400_000;

export interface HitSpec {
  key: "primary" | "secondary";
  label: string;
  /** Hit: a close at or above entry × target. */
  target: number;
  /** Stop: a close at or below entry × stop. */
  stop: number;
  windowDays: number;
  /** "Still young" recall ends when the close first reaches low × halfway (§6). */
  halfway: number;
}

// §2
export const PRIMARY: HitSpec = { key: "primary", label: "Primary: +100% before −50%, 180 days", target: 2, stop: 0.5, windowDays: 180, halfway: 1.5 };
export const SECONDARY: HitSpec = { key: "secondary", label: "Secondary: +50% before −50%, 90 days", target: 1.5, stop: 0.5, windowDays: 90, halfway: 1.25 };

/** Every fixed number in the methodology, in one place. */
export const DISCOVERY_RULES = {
  /** §2: entry is the first close after the flag day, at most this many days later. */
  maxEntryDelayDays: 3,
  /** §2: gap exclusions. */
  maxGapDays: 7,
  maxMissingShare: 0.1,
  /** §3: a test day needs this many eligible coins; §5: an event needs this many evaluable comparison coins. */
  minEligiblePerDay: 20,
  minComparison: 20,
  /** §6: credit windows start this many days before a run's low. */
  recallLookbackDays: 90,
  /** §6: holding-period returns. */
  holdingDays: [30, 60, 90, 180],
  cost: 0.005,
  maxReturn: 5,
  /** §8 */
  bootstrapRuns: 2000,
  seed: 42,
  minEvents: 50,
  minCoins: 20,
  minQuarters: 8,
  /** §9, criterion 4 (fractions: 0.05 = 5 percentage points). */
  maeMedianTolerance: 0.05,
  maeP10Tolerance: 0.1,
  stopRateTolerance: 0.05,
  /** §6: share of events with a maximum drawdown at least this deep. */
  severeDrawdown: 0.8,
  /** §9: concentration check. */
  topContributors: 5,
} as const;

const R = DISCOVERY_RULES;

// ---- Dates ----

export const dayNum = (date: string) => Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
export const fromDayNum = (n: number) => new Date(n * DAY_MS).toISOString().slice(0, 10);
/** Calendar quarter as a sortable number: year × 4 + (0–3). */
export const quarterOf = (date: string) => Number(date.slice(0, 4)) * 4 + Math.floor((Number(date.slice(5, 7)) - 1) / 3);
export const quarterLabel = (q: number) => `${Math.floor(q / 4)} Q${(q % 4) + 1}`;

/** First index whose date is after `date` (dates sorted ascending). */
function firstAfter(dates: string[], date: string): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ---- Prices and outcomes (§2) ----

/** One coin's cleaned daily closes (ascending dates, gaps allowed). */
export interface PricePath {
  symbol: string;
  dates: string[];
  closes: number[];
  /** Binance has delisted the pair: its series ends for good, so a window cut short is an outcome, not immaturity. */
  delisted: boolean;
}

export type OutcomeKind = "hit" | "stopped" | "expired" | "delisted" | "immature" | "gap" | "noEntry";

export interface Outcome {
  kind: OutcomeKind;
  /** Hits, stops, expiries and delisted-no-hit count; the rest are excluded. */
  evaluable: boolean;
  hit: boolean;
  entryDate: string | null;
  entryPrice: number | null;
  /** Hit or stop date, else the window's last close. */
  resolvedDate: string | null;
  /** Close at resolution ÷ entry − 1, before costs. */
  resolvedReturn: number | null;
  /** Lowest close from entry to resolution, as a return (≤ 0). */
  mae: number | null;
  /** Largest peak-to-trough fall over the full window from entry, as a positive loss. */
  maxDrawdown: number | null;
  /** After costs, capped, by holding period in days (null when that period hasn't matured). */
  holding: Record<number, number | null>;
}

const excluded = (kind: OutcomeKind, entryDate: string | null = null, entryPrice: number | null = null): Outcome => ({
  kind,
  evaluable: false,
  hit: false,
  entryDate,
  entryPrice,
  resolvedDate: null,
  resolvedReturn: null,
  mae: null,
  maxDrawdown: null,
  holding: {},
});

/**
 * The outcome of flagging `p` at the close of `flagDate`: entry at the next close
 * (within 3 days), then whichever of target and stop a daily close reaches first within the window.
 */
export function evaluateOutcome(p: PricePath, flagDate: string, spec: HitSpec): Outcome {
  const n = p.dates.length;
  const lastDay = n ? dayNum(p.dates[n - 1]) : -Infinity;
  const flagDay = dayNum(flagDate);
  const k = firstAfter(p.dates, flagDate);
  if (k >= n || dayNum(p.dates[k]) - flagDay > R.maxEntryDelayDays) {
    // A still-trading coin whose data simply ends: we can't know yet. A delisted one never traded again.
    return excluded(!p.delisted && lastDay < flagDay + R.maxEntryDelayDays ? "immature" : "noEntry");
  }
  const entryDate = p.dates[k];
  const entry = p.closes[k];
  const entryDay = dayNum(entryDate);
  const windowEnd = entryDay + spec.windowDays;
  const cutShort = lastDay < windowEnd;
  if (cutShort && !p.delisted) return excluded("immature", entryDate, entry);

  // Last bar inside the window; a delisted coin's window ends at its last close.
  let e = k;
  while (e + 1 < n && dayNum(p.dates[e + 1]) <= windowEnd) e++;
  const endDay = cutShort ? lastDay : windowEnd;

  // Gaps: any stretch over 7 days without a close (including up to the window's end), or over 10% of days missing.
  for (let j = k + 1; j <= e; j++) if (dayNum(p.dates[j]) - dayNum(p.dates[j - 1]) > R.maxGapDays) return excluded("gap", entryDate, entry);
  if (endDay - dayNum(p.dates[e]) > R.maxGapDays) return excluded("gap", entryDate, entry);
  const expected = endDay - entryDay;
  if (expected > 0 && (expected - (e - k)) / expected > R.maxMissingShare) return excluded("gap", entryDate, entry);

  let kind: OutcomeKind = cutShort ? "delisted" : "expired";
  let r = e;
  for (let j = k + 1; j <= e; j++) {
    if (p.closes[j] >= entry * spec.target) {
      kind = "hit";
      r = j;
      break;
    }
    if (p.closes[j] <= entry * spec.stop) {
      kind = "stopped";
      r = j;
      break;
    }
  }

  let low = entry;
  for (let j = k; j <= r; j++) low = Math.min(low, p.closes[j]);
  let peak = entry;
  let maxDrawdown = 0;
  for (let j = k; j <= e; j++) {
    peak = Math.max(peak, p.closes[j]);
    maxDrawdown = Math.max(maxDrawdown, 1 - p.closes[j] / peak);
  }

  const holding: Record<number, number | null> = {};
  for (const h of R.holdingDays) {
    if (!p.delisted && lastDay < entryDay + h) {
      holding[h] = null;
      continue;
    }
    let j = k;
    while (j + 1 < n && dayNum(p.dates[j + 1]) <= entryDay + h) j++;
    holding[h] = Math.min(R.maxReturn, p.closes[j] / entry - 1) - R.cost;
  }

  return {
    kind,
    evaluable: true,
    hit: kind === "hit",
    entryDate,
    entryPrice: entry,
    resolvedDate: p.dates[r],
    resolvedReturn: p.closes[r] / entry - 1,
    mae: low / entry - 1,
    maxDrawdown,
    holding,
  };
}

// ---- The panel: eligible coins on each test day (§3) ----

export interface DayCoin {
  /** Index into `Panel.prices`. */
  coin: number;
  score: number;
  /** Fee data available on that day (point-in-time). */
  hasFees: boolean;
}

export interface TestDay {
  date: string;
  bull: boolean;
  /** Eligible coins only (history, liquidity, scorable). */
  coins: DayCoin[];
}

export interface Panel {
  days: TestDay[];
  prices: PricePath[];
  /** Last date with data (BTC's last close). */
  lastDate: string;
}

export interface Rule {
  label: string;
  flag: (c: DayCoin) => boolean;
}

/**
 * The test's days: every test day whose window can mature (flag + 1 + window ≤ last date),
 * restricted to coins the universe includes, keeping days with at least 20 eligible coins.
 */
export function testPeriod(panel: Panel, spec: HitSpec, include: (coin: number) => boolean = () => true) {
  const lastFlag = fromDayNum(dayNum(panel.lastDate) - spec.windowDays - 1);
  const inRange = panel.days.filter((d) => d.date <= lastFlag).map((d) => ({ ...d, coins: d.coins.filter((c) => include(c.coin)) }));
  const days = inRange.filter((d) => d.coins.length >= R.minEligiblePerDay);
  return { days, thinDays: inRange.length - days.length, lastFlag };
}

// ---- Discovery events and their baselines (§4, §5) ----

export type EventExclusion = "noEntry" | "immature" | "gap" | "thinBaseline";

export interface DiscoveryEvent {
  coin: number;
  symbol: string;
  flagDate: string;
  quarter: number;
  bull: boolean;
  score: number;
  hasFees: boolean;
  outcome: Outcome;
  exclusion: EventExclusion | null;
  /** Date-matched baseline: the other eligible coins that day, evaluated the same way. */
  base: { n: number; hits: number; rate: number } | null;
  /** The same, restricted to coins with fee data that day (null when fewer than 20). */
  feesBase: { n: number; hits: number; rate: number } | null;
  /** Evaluable comparison outcomes (for the downside comparison; not serialized). */
  baseOutcomes: Outcome[];
}

export function outcomeCache(panel: Panel, spec: HitSpec) {
  const cache = new Map<string, Outcome>();
  return (coin: number, date: string): Outcome => {
    const key = `${coin}|${date}`;
    let o = cache.get(key);
    if (!o) {
      o = evaluateOutcome(panel.prices[coin], date, spec);
      cache.set(key, o);
    }
    return o;
  };
}

/**
 * Walks the test days in order. A flag on a coin with no open window becomes an event; that coin
 * then can't produce another until the event's window has ended (the cooldown), whatever the event's outcome.
 */
export function discoveryEvents(panel: Panel, days: TestDay[], spec: HitSpec, rule: Rule, outcome = outcomeCache(panel, spec)): DiscoveryEvent[] {
  const openUntil = new Map<number, number>();
  const events: DiscoveryEvent[] = [];
  for (const day of days) {
    const d = dayNum(day.date);
    for (const c of day.coins) {
      if (!rule.flag(c) || d <= (openUntil.get(c.coin) ?? -Infinity)) continue;
      const o = outcome(c.coin, day.date);
      openUntil.set(c.coin, (o.entryDate ? dayNum(o.entryDate) : d + 1) + spec.windowDays);

      const group = day.coins.filter((x) => x.coin !== c.coin).map((x) => ({ x, o: outcome(x.coin, day.date) })).filter((g) => g.o.evaluable);
      const rate = (rows: typeof group) => ({ n: rows.length, hits: rows.filter((g) => g.o.hit).length, rate: rows.filter((g) => g.o.hit).length / rows.length });
      const fees = group.filter((g) => g.x.hasFees);
      const exclusion: EventExclusion | null = !o.evaluable ? (o.kind as EventExclusion) : group.length < R.minComparison ? "thinBaseline" : null;
      events.push({
        coin: c.coin,
        symbol: panel.prices[c.coin].symbol,
        flagDate: day.date,
        quarter: quarterOf(day.date),
        bull: day.bull,
        score: c.score,
        hasFees: c.hasFees,
        outcome: o,
        exclusion,
        base: group.length ? rate(group) : null,
        feesBase: fees.length >= R.minComparison ? rate(fees) : null,
        baseOutcomes: group.map((g) => g.o),
      });
    }
  }
  return events;
}

// ---- Metrics (§6) ----

/** Weighted quantile: the smallest value whose cumulative weight reaches q of the total. */
export function weightedQuantile(items: { v: number; w: number }[], q: number): number | null {
  if (!items.length) return null;
  const s = [...items].sort((a, b) => a.v - b.v);
  const total = s.reduce((t, x) => t + x.w, 0);
  let cum = 0;
  for (const x of s) {
    cum += x.w;
    if (cum >= q * total - 1e-12) return x.v;
  }
  return s[s.length - 1].v;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const weightedMean = (items: { v: number; w: number }[]) => {
  const w = items.reduce((t, x) => t + x.w, 0);
  return w ? items.reduce((t, x) => t + x.v * x.w, 0) / w : null;
};
const unit = (vs: number[]) => vs.map((v) => ({ v, w: 1 }));

export interface HitMetrics {
  events: number;
  uniqueCoins: number;
  quarters: number;
  /** Distinct quarters with events ÷ 2: descriptive, not a count of independent blocks (§8). */
  coverage: number;
  hits: number;
  stopped: number;
  expired: number;
  delistedNoHit: number;
  hitRate: number | null;
  baseRate: number | null;
  /** Average of (hit − date-matched base rate): the pass/fail statistic. */
  excess: number | null;
  lift: number | null;
  falsePositiveRate: number | null;
  /** Against coins with fee data on the same dates (information for H0). */
  feesBase: { events: number; rate: number | null; excess: number | null };
  downside: {
    maeMedian: number | null;
    maeP10: number | null;
    baseMaeMedian: number | null;
    baseMaeP10: number | null;
    stopRate: number | null;
    baseStopRate: number | null;
    maxDrawdownMedian: number | null;
    maxDrawdownP90: number | null;
    baseMaxDrawdownMedian: number | null;
    baseMaxDrawdownP90: number | null;
    severeShare: number | null;
    worst: { symbol: string; flagDate: string; maxDrawdown: number }[];
  };
  holding: { days: number; n: number; mean: number | null; median: number | null; positive: number | null; baseMean: number | null; baseMedian: number | null }[];
}

export const evaluable = (events: DiscoveryEvent[]) => events.filter((e) => e.exclusion === null);

export function hitMetrics(all: DiscoveryEvent[]): HitMetrics {
  const ev = evaluable(all);
  const n = ev.length;
  const count = (k: OutcomeKind) => ev.filter((e) => e.outcome.kind === k).length;
  const hits = count("hit");
  const quarters = new Set(ev.map((e) => e.quarter)).size;
  const baseRate = mean(ev.map((e) => (e.base as { rate: number }).rate));
  const excess = mean(ev.map((e) => (e.outcome.hit ? 1 : 0) - (e.base as { rate: number }).rate));
  const withFees = ev.filter((e) => e.feesBase);
  // Each event's comparison group carries a total weight of 1 (§6).
  const baseW = <T>(pick: (o: Outcome) => T | null) =>
    ev.flatMap((e) => e.baseOutcomes.flatMap((o) => (pick(o) === null ? [] : [{ v: pick(o) as T, w: 1 / e.baseOutcomes.length }])));
  const maes = ev.map((e) => e.outcome.mae as number);
  const dds = ev.map((e) => e.outcome.maxDrawdown as number);
  const baseMae = baseW((o) => o.mae) as { v: number; w: number }[];
  const baseDd = baseW((o) => o.maxDrawdown) as { v: number; w: number }[];
  const baseStop = baseW((o) => (o.kind === "stopped" ? 1 : 0)) as { v: number; w: number }[];

  return {
    events: n,
    uniqueCoins: new Set(ev.map((e) => e.coin)).size,
    quarters,
    coverage: quarters / 2,
    hits,
    stopped: count("stopped"),
    expired: count("expired"),
    delistedNoHit: count("delisted"),
    hitRate: n ? hits / n : null,
    baseRate,
    excess,
    lift: n && baseRate ? hits / n / baseRate : null,
    falsePositiveRate: n ? (n - hits) / n : null,
    feesBase: {
      events: withFees.length,
      rate: mean(withFees.map((e) => (e.feesBase as { rate: number }).rate)),
      excess: mean(withFees.map((e) => (e.outcome.hit ? 1 : 0) - (e.feesBase as { rate: number }).rate)),
    },
    downside: {
      maeMedian: weightedQuantile(unit(maes), 0.5),
      maeP10: weightedQuantile(unit(maes), 0.1),
      baseMaeMedian: weightedQuantile(baseMae, 0.5),
      baseMaeP10: weightedQuantile(baseMae, 0.1),
      stopRate: n ? count("stopped") / n : null,
      baseStopRate: weightedMean(baseStop),
      maxDrawdownMedian: weightedQuantile(unit(dds), 0.5),
      maxDrawdownP90: weightedQuantile(unit(dds), 0.9),
      baseMaxDrawdownMedian: weightedQuantile(baseDd, 0.5),
      baseMaxDrawdownP90: weightedQuantile(baseDd, 0.9),
      severeShare: n ? dds.filter((d) => d >= R.severeDrawdown).length / n : null,
      worst: [...ev]
        .sort((a, b) => (b.outcome.maxDrawdown as number) - (a.outcome.maxDrawdown as number))
        .slice(0, 5)
        .map((e) => ({ symbol: e.symbol, flagDate: e.flagDate, maxDrawdown: e.outcome.maxDrawdown as number })),
    },
    holding: R.holdingDays.map((h) => {
      const rs = ev.flatMap((e) => (e.outcome.holding[h] == null ? [] : [e.outcome.holding[h] as number]));
      const base = baseW((o) => o.holding[h] ?? null) as { v: number; w: number }[];
      return {
        days: h,
        n: rs.length,
        mean: mean(rs),
        median: weightedQuantile(unit(rs), 0.5),
        positive: rs.length ? rs.filter((r) => r > 0).length / rs.length : null,
        baseMean: weightedMean(base),
        baseMedian: weightedQuantile(base, 0.5),
      };
    }),
  };
}

export function exclusionCounts(events: DiscoveryEvent[]): Record<EventExclusion, number> {
  const out: Record<EventExclusion, number> = { noEntry: 0, immature: 0, gap: 0, thinBaseline: 0 };
  for (const e of events) if (e.exclusion) out[e.exclusion]++;
  return out;
}

/** Excess hit rate with the coins contributing most to it removed (§9 concentration check). */
export function withoutTopContributors(events: DiscoveryEvent[], k = R.topContributors) {
  const ev = evaluable(events);
  const byCoin = new Map<number, { symbol: string; contribution: number }>();
  for (const e of ev) {
    const c = byCoin.get(e.coin) ?? { symbol: e.symbol, contribution: 0 };
    c.contribution += (e.outcome.hit ? 1 : 0) - (e.base as { rate: number }).rate;
    byCoin.set(e.coin, c);
  }
  const top = [...byCoin.entries()].sort((a, b) => b[1].contribution - a[1].contribution).slice(0, k);
  const drop = new Set(top.map(([coin]) => coin));
  const rest = ev.filter((e) => !drop.has(e.coin));
  return {
    removed: top.map(([, c]) => c),
    events: rest.length,
    excess: mean(rest.map((e) => (e.outcome.hit ? 1 : 0) - (e.base as { rate: number }).rate)),
  };
}

// ---- Bootstrap (§8) ----

/** Deterministic PRNG, so the same data gives the same interval. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BlockScheme = "moving2" | "single" | "halfYear";

/** Candidate blocks over quarter positions 0…Q−1 (position 0 = `firstQuarter`). */
export function candidateBlocks(scheme: BlockScheme, firstQuarter: number, Q: number): number[][] {
  if (scheme === "single") return Array.from({ length: Q }, (_, q) => [q]);
  if (scheme === "moving2") return Array.from({ length: Math.max(Q - 1, 1) }, (_, q) => (Q > 1 ? [q, q + 1] : [q]));
  // Fixed calendar half-years: Jan–Jun and Jul–Dec; the period's partial halves at either end are their own blocks.
  const halves = new Map<number, number[]>();
  for (let q = 0; q < Q; q++) {
    const h = Math.floor((firstQuarter + q) / 2);
    halves.set(h, [...(halves.get(h) ?? []), q]);
  }
  return [...halves.values()];
}

/**
 * One resample's quarter positions. Moving and single blocks are drawn with replacement and laid end to end
 * until exactly Q positions (the last block truncated if needed); fixed half-years draw as many halves as there are.
 */
export function drawPositions(rand: () => number, blocks: number[][], scheme: BlockScheme, Q: number): number[] {
  const out: number[] = [];
  if (scheme === "halfYear") {
    for (let i = 0; i < blocks.length; i++) out.push(...blocks[Math.floor(rand() * blocks.length)]);
    return out;
  }
  while (out.length < Q) {
    const b = blocks[Math.floor(rand() * blocks.length)];
    for (const q of b) if (out.length < Q) out.push(q);
  }
  return out;
}

export interface Interval {
  low: number | null;
  high: number | null;
  /** Resamples with no events for this group, left out of its interval. */
  dropped: number;
}

/**
 * 90% intervals for the excess hit rate, overall / bull / bear, from the SAME resampled
 * blocks in each resample. A quarter drawn twice contributes its events twice.
 */
export function bootstrapExcess(
  events: { quarter: number; bull: boolean; diff: number }[],
  firstQuarter: number,
  Q: number,
  scheme: BlockScheme,
  runs: number = R.bootstrapRuns,
  seed: number = R.seed,
  rand: () => number = mulberry32(seed),
): Record<"overall" | "bull" | "bear", Interval> {
  const sums = { overall: new Array(Q).fill(0), bull: new Array(Q).fill(0), bear: new Array(Q).fill(0) };
  const counts = { overall: new Array(Q).fill(0), bull: new Array(Q).fill(0), bear: new Array(Q).fill(0) };
  for (const e of events) {
    const q = e.quarter - firstQuarter;
    if (q < 0 || q >= Q) continue;
    for (const g of ["overall", e.bull ? "bull" : "bear"] as const) {
      sums[g][q] += e.diff;
      counts[g][q]++;
    }
  }
  const blocks = candidateBlocks(scheme, firstQuarter, Q);
  const values = { overall: [] as number[], bull: [] as number[], bear: [] as number[] };
  const dropped = { overall: 0, bull: 0, bear: 0 };
  for (let r = 0; r < runs; r++) {
    const positions = drawPositions(rand, blocks, scheme, Q);
    for (const g of ["overall", "bull", "bear"] as const) {
      let s = 0;
      let c = 0;
      for (const q of positions) {
        s += sums[g][q];
        c += counts[g][q];
      }
      if (c) values[g].push(s / c);
      else dropped[g]++;
    }
  }
  const interval = (g: "overall" | "bull" | "bear"): Interval => {
    const v = values[g].sort((a, b) => a - b);
    return v.length ? { low: v[Math.floor(v.length * 0.05)], high: v[Math.floor(v.length * 0.95)], dropped: dropped[g] } : { low: null, high: null, dropped: dropped[g] };
  };
  return { overall: interval("overall"), bull: interval("bull"), bear: interval("bear") };
}

/** §7: runs of 3+ consecutive quarters where bear test days are the majority. */
export function bearEpisodes(days: { date: string; bull: boolean }[]): number[][] {
  const byQ = new Map<number, { bull: number; bear: number }>();
  for (const d of days) {
    const q = quarterOf(d.date);
    const e = byQ.get(q) ?? { bull: 0, bear: 0 };
    e[d.bull ? "bull" : "bear"]++;
    byQ.set(q, e);
  }
  const qs = [...byQ.keys()].sort((a, b) => a - b);
  const episodes: number[][] = [];
  let cur: number[] = [];
  for (const q of qs) {
    const e = byQ.get(q) as { bull: number; bear: number };
    if (e.bear > e.bull && (!cur.length || cur[cur.length - 1] === q - 1)) cur.push(q);
    else {
      if (cur.length >= 3) episodes.push(cur);
      cur = e.bear > e.bull ? [q] : [];
    }
  }
  if (cur.length >= 3) episodes.push(cur);
  return episodes;
}

// ---- Recall: qualifying runs and one-to-one matching (§6) ----

export interface Credit {
  flagDate: string;
  timing: "preLow" | "postLow";
  /** Pre-low: days from the flag to the low. */
  daysBeforeLow: number | null;
  /** Post-low: (entry − low) ÷ (peak − low), clipped to 0–1, at the D+1 entry price. */
  moveCompleted: number | null;
}

export interface RunRecord {
  coin: number;
  symbol: string;
  lowDate: string;
  lowPrice: number;
  peakDate: string;
  peakPrice: number;
  /** No 30% fall after the peak before the data ends: the peak is the highest close so far. */
  provisional: boolean;
  targetDate: string;
  halfwayDate: string;
  status: "qualifying" | "notEligible";
  bull: boolean | null;
  early: Credit | null;
  young: Credit | null;
}

/** Runs that met the spec's condition (close ≥ low × target within the window from the low), with the low inside [from, to]. */
export function qualifyingRuns(p: PricePath, coin: number, spec: HitSpec, from: string, to: string) {
  const series = p.dates.map((date, i) => ({ date, price: p.closes[i], volume: 0, marketCap: null }));
  const out: Omit<RunRecord, "status" | "bull" | "early" | "young">[] = [];
  for (const run of findRuns(series, spec.target - 1, 0.3)) {
    const lowDate = p.dates[run.lowIndex];
    if (lowDate < from || lowDate > to) continue;
    const low = p.closes[run.lowIndex];
    let target = -1;
    let halfway = -1;
    for (let j = run.lowIndex + 1; j <= run.peakIndex; j++) {
      if (halfway < 0 && p.closes[j] >= low * spec.halfway) halfway = j;
      if (p.closes[j] >= low * spec.target) {
        target = j;
        break;
      }
    }
    if (target < 0 || dayNum(p.dates[target]) - dayNum(lowDate) > spec.windowDays) continue;
    const peak = p.closes[run.peakIndex];
    let ended = false;
    for (let j = run.peakIndex + 1; j < p.closes.length && !ended; j++) ended = p.closes[j] <= peak * 0.7;
    out.push({
      coin,
      symbol: p.symbol,
      lowDate,
      lowPrice: low,
      peakDate: p.dates[run.peakIndex],
      peakPrice: peak,
      provisional: !ended,
      targetDate: p.dates[target],
      halfwayDate: p.dates[halfway],
    });
  }
  return out;
}

/**
 * Greedy one-to-one matching: windows in order, each taking the earliest unused point inside it.
 * When both window ends increase from one window to the next (runs of one coin never overlap),
 * this reaches the maximum number of matched windows and prefers the earliest flags.
 * Returns the matched point index per window (or −1).
 */
export function greedyMatch(windows: [number, number][], points: number[]): number[] {
  const used = new Set<number>();
  return windows.map(([a, b]) => {
    for (let i = 0; i < points.length; i++) {
      if (points[i] >= a && points[i] <= b && !used.has(i)) {
        used.add(i);
        return i;
      }
    }
    return -1;
  });
}

/** General maximum bipartite matching size (augmenting paths), to check the greedy result. */
export function maxMatchingSize(windows: [number, number][], points: number[]): number {
  const owner = new Array<number>(points.length).fill(-1);
  const tryWindow = (w: number, seen: boolean[]): boolean => {
    const [a, b] = windows[w];
    for (let i = 0; i < points.length; i++) {
      if (points[i] < a || points[i] > b || seen[i]) continue;
      seen[i] = true;
      if (owner[i] < 0 || tryWindow(owner[i], seen)) {
        owner[i] = w;
        return true;
      }
    }
    return false;
  };
  let size = 0;
  for (let w = 0; w < windows.length; w++) if (tryWindow(w, new Array(points.length).fill(false))) size++;
  return size;
}

export interface RecallMetrics {
  qualifying: number;
  notEligible: number;
  earlyCredited: number;
  earlyRecall: number | null;
  youngCredited: number;
  youngRecall: number | null;
  preLow: { share: number | null; daysMedian: number | null; daysMin: number | null; daysMax: number | null };
  postLow: { share: number | null; movedMedian: number | null; movedMin: number | null; movedMax: number | null };
}

/**
 * Qualifying runs for every coin, credited one-to-one to flag days (not discovery events) inside each
 * credit window. Throws if the greedy matching ever falls short of the general maximum (a harness bug).
 */
export function recall(panel: Panel, period: TestDay[], spec: HitSpec, rule: Rule, include: (coin: number) => boolean = () => true): RunRecord[] {
  if (!period.length) return [];
  const from = period[0].date;
  const to = period[period.length - 1].date;
  // Test days only (§3: 20+ eligible coins), over the whole panel: credit windows can start before the period or end after it.
  const allDays = panel.days.map((d) => ({ ...d, coins: d.coins.filter((c) => include(c.coin)) })).filter((d) => d.coins.length >= R.minEligiblePerDay);
  const dayDates = allDays.map((d) => d.date);
  const flagsByCoin = new Map<number, string[]>();
  for (const d of allDays) for (const c of d.coins) if (rule.flag(c)) flagsByCoin.set(c.coin, [...(flagsByCoin.get(c.coin) ?? []), d.date]);

  const records: RunRecord[] = [];
  panel.prices.forEach((p, coin) => {
    if (!include(coin)) return;
    const runs = qualifyingRuns(p, coin, spec, from, to).map((r): RunRecord => {
      // Eligible if it's among the eligible coins on the last test day on or before its low (within 3 days).
      const k = firstAfter(dayDates, r.lowDate) - 1;
      const day = k >= 0 && dayNum(r.lowDate) - dayNum(allDays[k].date) <= R.maxEntryDelayDays ? allDays[k] : null;
      const eligible = !!day?.coins.some((c) => c.coin === coin);
      return { ...r, status: eligible ? "qualifying" : "notEligible", bull: day ? day.bull : null, early: null, young: null };
    });
    const qual = runs.filter((r) => r.status === "qualifying");
    const flags = flagsByCoin.get(coin) ?? [];
    const points = flags.map(dayNum);
    for (const kind of ["early", "young"] as const) {
      const windows = qual.map((r): [number, number] => [dayNum(r.lowDate) - R.recallLookbackDays, dayNum(kind === "early" ? r.lowDate : r.halfwayDate)]);
      const match = greedyMatch(windows, points);
      if (match.filter((m) => m >= 0).length !== maxMatchingSize(windows, points)) {
        throw new Error(`Recall matching for ${p.symbol} (${kind}) fell short of the maximum: a harness bug.`);
      }
      match.forEach((m, i) => {
        if (m < 0) return;
        const r = qual[i];
        const flagDate = flags[m];
        const pre = points[m] <= dayNum(r.lowDate);
        const entry = pre ? null : evaluateEntry(p, flagDate);
        r[kind] = {
          flagDate,
          timing: pre ? "preLow" : "postLow",
          daysBeforeLow: pre ? dayNum(r.lowDate) - points[m] : null,
          moveCompleted: pre || entry === null ? null : Math.min(1, Math.max(0, (entry - r.lowPrice) / (r.peakPrice - r.lowPrice))),
        };
      });
    }
    records.push(...runs);
  });
  return records;
}

/** The D+1 entry price for a flag (the first close within 3 days after it), or null. */
function evaluateEntry(p: PricePath, flagDate: string): number | null {
  const k = firstAfter(p.dates, flagDate);
  return k < p.dates.length && dayNum(p.dates[k]) - dayNum(flagDate) <= R.maxEntryDelayDays ? p.closes[k] : null;
}

export function recallMetrics(runs: RunRecord[]): RecallMetrics {
  const qual = runs.filter((r) => r.status === "qualifying");
  const early = qual.filter((r) => r.early);
  const young = qual.filter((r) => r.young);
  const pre = young.filter((r) => r.young?.timing === "preLow").map((r) => r.young?.daysBeforeLow as number);
  const post = young.filter((r) => r.young?.timing === "postLow").flatMap((r) => (r.young?.moveCompleted == null ? [] : [r.young.moveCompleted]));
  const postCount = young.filter((r) => r.young?.timing === "postLow").length;
  return {
    qualifying: qual.length,
    notEligible: runs.length - qual.length,
    earlyCredited: early.length,
    earlyRecall: qual.length ? early.length / qual.length : null,
    youngCredited: young.length,
    youngRecall: qual.length ? young.length / qual.length : null,
    preLow: {
      share: young.length ? pre.length / young.length : null,
      daysMedian: weightedQuantile(unit(pre), 0.5),
      daysMin: pre.length ? Math.min(...pre) : null,
      daysMax: pre.length ? Math.max(...pre) : null,
    },
    postLow: {
      share: young.length ? postCount / young.length : null,
      movedMedian: weightedQuantile(unit(post), 0.5),
      movedMin: post.length ? Math.min(...post) : null,
      movedMax: post.length ? Math.max(...post) : null,
    },
  };
}

// ---- One test, end to end ----

export interface Group<T> {
  overall: T;
  bull: T;
  bear: T;
}

export interface TestResult {
  spec: HitSpec;
  period: { from: string | null; to: string | null; testDays: number; thinDays: number; quarters: number };
  flagDays: number;
  eligibleCoinDays: number;
  flaggedShare: number | null;
  events: Group<{ total: number; exclusions: Record<EventExclusion, number> }>;
  metrics: Group<HitMetrics>;
  intervals: Record<BlockScheme, Group<Interval>>;
  episodes: { quarters: string[]; events: number; excess: number | null }[];
  concentration: ReturnType<typeof withoutTopContributors>;
  byYear: { year: string; events: number; hitRate: number | null; baseRate: number | null; excess: number | null }[];
  recall: Group<RecallMetrics>;
  eventRows: DiscoveryEvent[];
  runRows: RunRecord[];
}

export function runTest(panel: Panel, spec: HitSpec, rule: Rule, include: (coin: number) => boolean = () => true): TestResult {
  const { days, thinDays } = testPeriod(panel, spec, include);
  const outcome = outcomeCache(panel, spec);
  const events = discoveryEvents(panel, days, spec, rule, outcome);
  const ev = evaluable(events);
  const split = <T>(f: (xs: DiscoveryEvent[]) => T): Group<T> => ({ overall: f(events), bull: f(events.filter((e) => e.bull)), bear: f(events.filter((e) => !e.bull)) });

  const firstQuarter = days.length ? quarterOf(days[0].date) : 0;
  const Q = days.length ? quarterOf(days[days.length - 1].date) - firstQuarter + 1 : 0;
  const diffs = ev.map((e) => ({ quarter: e.quarter, bull: e.bull, diff: (e.outcome.hit ? 1 : 0) - (e.base as { rate: number }).rate }));
  const intervals = Object.fromEntries((["moving2", "single", "halfYear"] as BlockScheme[]).map((s) => [s, bootstrapExcess(diffs, firstQuarter, Q, s)])) as Record<BlockScheme, Group<Interval>>;

  const episodes = bearEpisodes(days).map((qs) => {
    const inEp = ev.filter((e) => !e.bull && qs.includes(e.quarter));
    return { quarters: qs.map(quarterLabel), events: inEp.length, excess: mean(inEp.map((e) => (e.outcome.hit ? 1 : 0) - (e.base as { rate: number }).rate)) };
  });

  const years = [...new Set(ev.map((e) => e.flagDate.slice(0, 4)))].sort();
  const runs = recall(panel, days, spec, rule, include);
  const flagDays = days.reduce((s, d) => s + d.coins.filter(rule.flag).length, 0);
  const eligibleCoinDays = days.reduce((s, d) => s + d.coins.length, 0);

  return {
    spec,
    period: { from: days[0]?.date ?? null, to: days[days.length - 1]?.date ?? null, testDays: days.length, thinDays, quarters: Q },
    flagDays,
    eligibleCoinDays,
    flaggedShare: eligibleCoinDays ? flagDays / eligibleCoinDays : null,
    events: split((xs) => ({ total: xs.length, exclusions: exclusionCounts(xs) })),
    metrics: split(hitMetrics),
    intervals,
    episodes,
    concentration: withoutTopContributors(events),
    byYear: years.map((year) => {
      const m = hitMetrics(events.filter((e) => e.flagDate.startsWith(year)));
      return { year, events: m.events, hitRate: m.hitRate, baseRate: m.baseRate, excess: m.excess };
    }),
    recall: {
      overall: recallMetrics(runs),
      bull: recallMetrics(runs.filter((r) => r.bull === true)),
      bear: recallMetrics(runs.filter((r) => r.bull === false)),
    },
    eventRows: events,
    runRows: runs,
  };
}

// ---- Verdict (§9) ----

export interface Criterion {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export type VerdictKind = "Pass" | "Pass (fragile)" | "Fail" | "Inconclusive";

const pts = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)} pts`);

export function discoveryVerdict(primary: TestResult, secondary: TestResult): { verdict: VerdictKind; criteria: Criterion[]; fragile: string[] } {
  const m = primary.metrics;
  const ci = primary.intervals.moving2;
  const ciText = (i: Interval) => `90% interval ${pts(i.low)} to ${pts(i.high)}`;
  const excessOk = (g: "overall" | "bull" | "bear"): Criterion => ({
    id: g === "overall" ? "1" : g === "bull" ? "2" : "3",
    label: `Primary excess hit rate > 0 with its interval above zero (${g})`,
    passed: (m[g].excess ?? 0) > 0 && (ci[g].low ?? 0) > 0,
    detail: `excess ${pts(m[g].excess)}, ${ciText(ci[g])}`,
  });
  const downside = (["bull", "bear"] as const).map((g) => {
    const d = m[g].downside;
    const medGap = d.maeMedian !== null && d.baseMaeMedian !== null ? d.maeMedian - d.baseMaeMedian : null;
    const p10Gap = d.maeP10 !== null && d.baseMaeP10 !== null ? d.maeP10 - d.baseMaeP10 : null;
    const stopGap = d.stopRate !== null && d.baseStopRate !== null ? d.stopRate - d.baseStopRate : null;
    return {
      ok: medGap !== null && p10Gap !== null && stopGap !== null && medGap >= -R.maeMedianTolerance && p10Gap >= -R.maeP10Tolerance && stopGap <= R.stopRateTolerance,
      text: `${g}: median MAE ${pts(medGap)} vs base, 10th-percentile MAE ${pts(p10Gap)}, stop rate ${pts(stopGap)}`,
    };
  });
  const s = secondary.metrics;
  const minimum = (["bull", "bear"] as const).map((g) => ({
    ok: m[g].events >= R.minEvents && m[g].uniqueCoins >= R.minCoins && m[g].quarters >= R.minQuarters,
    text: `${g}: ${m[g].events} events, ${m[g].uniqueCoins} coins, ${m[g].quarters} quarters`,
  }));

  const criteria: Criterion[] = [
    excessOk("overall"),
    excessOk("bull"),
    excessOk("bear"),
    {
      id: "4",
      label: `Downside not materially worse (median MAE ≤ ${R.maeMedianTolerance * 100} pts worse, 10th percentile ≤ ${R.maeP10Tolerance * 100}, stop rate ≤ ${R.stopRateTolerance * 100} higher; bull and bear)`,
      passed: downside.every((x) => x.ok),
      detail: downside.map((x) => x.text).join("; "),
    },
    {
      id: "5",
      label: "Secondary excess hit rate positive in bull and bear (supporting evidence, not independent proof)",
      passed: (s.bull.excess ?? 0) > 0 && (s.bear.excess ?? 0) > 0,
      detail: `bull ${pts(s.bull.excess)}, bear ${pts(s.bear.excess)}`,
    },
    {
      id: "6",
      label: `Sample minimums per regime (${R.minEvents} events, ${R.minCoins} coins, ${R.minQuarters} quarters)`,
      passed: minimum.every((x) => x.ok),
      detail: minimum.map((x) => x.text).join("; "),
    },
  ];

  const fragile: string[] = [];
  const half = primary.intervals.halfYear;
  for (const g of ["overall", "bull", "bear"] as const) {
    if (!((half[g].low ?? 0) > 0)) fragile.push(`Fixed half-year interval for ${g} includes zero (${pts(half[g].low)} to ${pts(half[g].high)}).`);
  }
  for (const ep of primary.episodes) {
    if (ep.excess !== null && ep.excess < 0) fragile.push(`Excess hit rate is negative in the bear episode ${ep.quarters[0]} – ${ep.quarters[ep.quarters.length - 1]} (${pts(ep.excess)}).`);
  }

  const verdict: VerdictKind = !criteria[5].passed ? "Inconclusive" : criteria.slice(0, 5).some((c) => !c.passed) ? "Fail" : fragile.length ? "Pass (fragile)" : "Pass";
  return { verdict, criteria, fragile };
}
