// Strategy backtest: replays the fundamental scorecard every few days over
// years of history on hundreds of coins, including coins Binance later
// delisted, and checks whether higher scores were followed by better returns.
// No technical analysis: price is only the outcome being measured (and the
// "usage vs price" valuation check).
//
// Point in time: each day's inputs use only data available before that day
// (fees lag a day). Categories that need data which only exists today
// (supply, audits, listings, your own ratings) are left out and listed.

import { quoteVolumes24h, spotUsdtPairs, type SpotPair } from "@/lib/providers/binance";
import { feeSourcesBySymbol, flowSeries, type FlowSeries, type FlowType } from "@/lib/providers/defillama";
import type { DailyBar } from "@/lib/providers/types";
import { setKv } from "@/lib/server/db";
import { pairBars } from "@/lib/server/history";
import type { JobProgress } from "@/lib/server/jobs";
import type { NarrativeAttention, NarrativeStage, StrategyBacktestResult, StrategyOptions, StrategyStats, StrategyValidation, ValidationRun } from "@/lib/types";
import { feesExpected } from "./categories";
import { CATEGORIES, combineCategories, scoreFundamentals, usageVsPrice, type CategoryKey, type Evidence, type FaInputs } from "./fundamentals";
import { buildersAt, buildSectors, marketLaunchesAt, type SectorBuild } from "./narratives";
import { listingTimes } from "@/lib/providers/defillama";
import { marketFees, MIN_FEE_MEMBERS, narrativeAttention, narrativeStage, phaseSeries, readingAt, STAGE_STRENGTH, summarizeFees } from "./narrative-rules";

export const LATEST_KEY = "backtest:strategy:latest";
/** Date the scoring rules last changed. Results on data after this are the only truly out-of-sample ones. */
export const RULES_FROZEN_AT = "2026-11-23";
/** Where the period check splits: the earlier period holds most of what the rules were tuned on. */
const PERIOD_SPLIT = "2024-01-01";
const RANDOM_WEIGHT_RUNS = 50;
/** The narrative stage ordering before it was adjusted on this backtest's data. */
const ORIGINAL_STAGE_STRENGTH: Record<NarrativeStage, number> = { Emerging: 85, Accelerating: 80, Quiet: 55, Maturing: 45, Fading: 20 };
export const STEP_DAYS = 3;
/** 30-day average volume (USDT) a coin needed that day to count, so it was actually buyable. */
export const MIN_LIQUIDITY = 1e6;
/** Days of history before a coin is scored (the 90-day checks need it). */
export const MIN_AGE = 100;
/** Each day's cross-section needs this many coins for a factor correlation. */
const MIN_CROSS_SECTION = 20;
const BOOTSTRAP_RUNS = 1000;
const DAY = 86_400_000;
/** A single hold's return is capped here so one freak pump can't swing an average of 100,000+ holds. */
export const MAX_RETURN = 5;
/** An overnight move bigger than this (either way) is a redenomination or a reused ticker, not a real price. */
const MAX_OVERNIGHT = 5;
/** Scorecard categories with at least one input that can be replayed historically. */
export const REPLAYED: CategoryKey[] = ["narrative", "adoption", "valueCapture", "execution", "valuation"];

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>, onDone: () => void): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
        onDone();
      }
    }),
  );
  return out;
}

// ---- Daily flows (fees, revenue, holders revenue) with O(1) window sums ----

interface FlowLookup {
  pos: Map<string, number>;
  cum: number[];
}

function lookup(s: FlowSeries | null | undefined): FlowLookup | null {
  if (!s?.values.length) return null;
  const cum: number[] = [];
  s.values.forEach((v, i) => cum.push((cum[i - 1] ?? 0) + v));
  return { pos: new Map(s.dates.map((d, i) => [d, i])), cum };
}

/** Sum over `days` days, ending `offset` days before yesterday (yesterday's data is the latest known on `date`). */
function windowSum(f: FlowLookup, date: string, offset: number, days: number): number | null {
  const end = f.pos.get(addDays(date, -1 - offset));
  if (end === undefined || end - days + 1 < 0) return null;
  return f.cum[end] - (end - days >= 0 ? f.cum[end - days] : 0);
}

const growth = (now: number | null, before: number | null) => (now !== null && before ? now / before - 1 : null);

function feeGrowth(f: FlowLookup, date: string) {
  return { g30: growth(windowSum(f, date, 0, 30), windowSum(f, date, 30, 30)), g90: growth(windowSum(f, date, 0, 90), windowSum(f, date, 90, 90)) };
}

// ---- Per-coin series ----

export interface CoinSeries {
  pair: SpotPair;
  closes: number[];
  pos: Map<string, number>;
  vol30: (number | null)[];
  fees: FlowLookup | null;
  revenue: FlowLookup | null;
  holders: FlowLookup | null;
  sectors: number[];
  /** Fees are the right yardstick for it (not a privacy, payments, storage or DePIN coin, by today's sector lists). */
  feesExpected: boolean;
}

/** Drops everything before the last impossible overnight jump, so prices on both sides of it are never compared. */
function cleanBars(bars: DailyBar[]): DailyBar[] {
  let start = 0;
  for (let i = 1; i < bars.length; i++) {
    const r = bars[i].close / bars[i - 1].close;
    if (r > MAX_OVERNIGHT || r < 1 / MAX_OVERNIGHT) start = i;
  }
  return start ? bars.slice(start) : bars;
}

function coinSeries(pair: SpotPair, raw: DailyBar[], flows: Partial<Record<FlowType, FlowSeries | null>>): CoinSeries {
  const bars = cleanBars(raw);
  const vs: number[] = [];
  bars.forEach((b, i) => vs.push((vs[i - 1] ?? 0) + b.volume));
  return {
    pair,
    closes: bars.map((b) => b.close),
    pos: new Map(bars.map((b, i) => [b.date, i])),
    vol30: bars.map((_, i) => (i >= 29 ? (vs[i] - (i >= 30 ? vs[i - 30] : 0)) / 30 : null)),
    fees: lookup(flows.dailyFees),
    revenue: lookup(flows.dailyRevenue),
    holders: lookup(flows.dailyHoldersRevenue),
    sectors: [],
    feesExpected: true,
  };
}

// ---- Stats ----

const FACTORS = {
  score: "Fundamental score (overall)",
  feesGrowth90d: "Fee growth (90d)",
  feesGrowth30d: "Fee growth (30d)",
  feesAnnualized: "Fee level",
  holderShare: "Share of fees to token holders",
  usageVsPrice: "Usage vs price (90d)",
  narrativeStrength: "Narrative stage",
  ageDays: "Track record (age)",
} as const;
type FactorKey = keyof typeof FACTORS;

interface Obs {
  coin: number;
  t: number;
  score: number;
  ret: number;
  btc: number | null;
  bull: boolean;
  hasFees: boolean;
  stage: NarrativeStage | null;
  attention: NarrativeAttention | null;
  delistedExit: boolean;
  x: Record<FactorKey, number | null>;
  /** Category scores and evidence, in CATEGORIES order, so weights can be varied without re-scoring. */
  cats: (number | null)[];
  evid: Evidence[];
}

function stats(obs: Obs[]): StrategyStats {
  if (!obs.length) return { count: 0, avgReturn: null, medianReturn: null, winRate: null, beatBtcRate: null };
  const rs = obs.map((o) => o.ret).sort((a, b) => a - b);
  const withBtc = obs.filter((o) => o.btc !== null);
  const mid = Math.floor(rs.length / 2);
  return {
    count: rs.length,
    avgReturn: rs.reduce((a, b) => a + b, 0) / rs.length,
    medianReturn: rs.length % 2 ? rs[mid] : (rs[mid - 1] + rs[mid]) / 2,
    winRate: rs.filter((r) => r > 0).length / rs.length,
    beatBtcRate: withBtc.length ? withBtc.filter((o) => o.ret > (o.btc as number)).length / withBtc.length : null,
  };
}

/** Deterministic PRNG so the same data gives the same confidence range. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 90% range for (signal average − baseline average). Signals are resampled by
 * calendar month, because coins move together: one good month lifts many signals at once.
 */
function edgeRange(signals: Obs[], dates: string[], baselineAvg: number): { low: number | null; high: number | null } {
  const byMonth = new Map<string, number[]>();
  for (const s of signals) {
    const m = dates[s.t].slice(0, 7);
    const list = byMonth.get(m);
    if (list) list.push(s.ret);
    else byMonth.set(m, [s.ret]);
  }
  const months = [...byMonth.values()];
  if (months.length < 6) return { low: null, high: null };
  const rand = mulberry32(42);
  const edges: number[] = [];
  for (let r = 0; r < BOOTSTRAP_RUNS; r++) {
    let sum = 0;
    let count = 0;
    for (let k = 0; k < months.length; k++) {
      const m = months[Math.floor(rand() * months.length)];
      for (const v of m) sum += v;
      count += m.length;
    }
    edges.push(sum / count - baselineAvg);
  }
  edges.sort((a, b) => a - b);
  return { low: edges[Math.floor(BOOTSTRAP_RUNS * 0.05)], high: edges[Math.floor(BOOTSTRAP_RUNS * 0.95)] };
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2;
    for (let k = i; k <= j; k++) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va && vb ? cov / Math.sqrt(va * vb) : null;
}

// ---- Replay data (shared with the early-discovery harness) ----

/** Everything a replay needs, loaded once: each coin's prices and fee flows, sector memberships, BTC. */
export interface ReplayData {
  coins: CoinSeries[];
  sectors: SectorBuild[];
  btcDates: string[];
  btc: number[];
  times: Awaited<ReturnType<typeof listingTimes>> | null;
  /** Trading pairs' base symbols by today's 24h volume, highest first (for a top-N universe). */
  tradingByVolume: string[];
  /** Coins DefiLlama lists fees for whose fee series didn't load (a failed download scores as "no fees"). */
  feeSeriesMissing: string[];
}

/**
 * The universe: trading pairs (the top `maxCoins` by today's volume, or all of them when 0)
 * plus every delisted pair, keeping coins with at least `minBars` cleaned daily bars.
 */
export async function loadReplay(maxCoins: number, minBars: number, report: (p: JobProgress) => void): Promise<ReplayData> {
  report({ stage: "Loading the coin list", done: 0, total: 0 });
  const [pairs, vols, feeSources] = await Promise.all([spotUsdtPairs(), quoteVolumes24h(), feeSourcesBySymbol()]);
  const all = [...pairs.values()].filter((p) => p.base !== "BTC");
  const trading = all.filter((p) => p.status === "TRADING").sort((a, b) => (vols.get(b.symbol) ?? 0) - (vols.get(a.symbol) ?? 0));
  const universe = [...(maxCoins ? trading.slice(0, maxCoins) : trading), ...all.filter((p) => p.status === "BREAK")];

  report({ stage: "Loading narratives (sector indexes and their fees)", done: 0, total: 0 });
  const [{ sectors, btcBars }, times] = await Promise.all([buildSectors(), listingTimes().catch(() => null)]);

  let done = 0;
  const barsList = await pool(
    universe,
    8,
    (p) => pairBars(p).catch(() => [] as DailyBar[]),
    () => report({ stage: "Loading price history", done: ++done, total: universe.length }),
  );

  const flowJobs = universe
    .filter((p) => feeSources.has(p.base))
    .flatMap((p) => (["dailyFees", "dailyRevenue", "dailyHoldersRevenue"] as FlowType[]).map((type) => ({ base: p.base, type })));
  done = 0;
  const flowList = await pool(
    flowJobs,
    6,
    (j) => flowSeries((feeSources.get(j.base) as { slug: string }).slug, j.type).catch(() => null),
    () => report({ stage: "Loading fee, revenue and holder-revenue history (DefiLlama)", done: ++done, total: flowJobs.length }),
  );
  const flows = new Map<string, Partial<Record<FlowType, FlowSeries | null>>>();
  flowJobs.forEach((j, i) => flows.set(j.base, { ...flows.get(j.base), [j.type]: flowList[i] }));

  const coins: CoinSeries[] = [];
  universe.forEach((p, i) => {
    const c = coinSeries(p, barsList[i], flows.get(p.base) ?? {});
    if (c.closes.length >= minBars) coins.push(c);
  });

  // Sector membership by ticker, checked against price so ticker clashes don't mix coins up.
  const bySymbol = new Map(coins.map((c) => [c.pair.base, c]));
  sectors.forEach((s, k) => {
    for (const m of s.coins) {
      const c = bySymbol.get(m.symbol.toUpperCase());
      const last = c?.closes[c.closes.length - 1];
      if (!c || !last || !m.current_price || Math.abs(last / m.current_price - 1) > 0.3) continue;
      if (!c.sectors.includes(k)) c.sectors.push(k);
    }
  });
  for (const c of coins) c.feesExpected = feesExpected(c.sectors.map((k) => sectors[k].name));

  const feeSeriesMissing = universe.filter((p) => feeSources.has(p.base) && !flows.get(p.base)?.dailyFees).map((p) => p.base);
  return { coins, sectors, btcDates: btcBars.map((b) => b.date), btc: btcBars.map((b) => b.close), times, tradingByVolume: trading.map((p) => p.base), feeSeriesMissing };
}

/** Bull market on BTC day `b`: BTC's close above the average of its last 200 closes (that day's included). Needs b >= 199. */
export function btcBullAt(btc: number[]): (b: number) => boolean {
  const sum: number[] = [];
  btc.forEach((c, i) => sum.push((sum[i - 1] ?? 0) + c));
  return (b) => btc[b] > (sum[b] - (b >= 200 ? sum[b - 200] : 0)) / 200;
}

export type DayNarrative = NonNullable<FaInputs["narrative"]> & { attention: NarrativeAttention };

/** Each sector's stage (fundamentals only: fees vs market, builders) and attention (price vs BTC) on each test day. */
export function sectorStages(data: ReplayData, testDays: number[]): Map<number, DayNarrative>[] {
  const { sectors, btcDates, times } = data;
  const sectorFees = sectors.map((s) => s.fees.map((f) => lookup(f.series)).filter((f): f is FlowLookup => f !== null));
  const allFees = [...new Map(sectors.flatMap((s) => s.fees.map((f) => [f.symbol, lookup(f.series)] as const))).values()].filter(
    (f): f is FlowLookup => f !== null,
  );
  const marketByDay = new Map(testDays.map((b) => [b, marketFees(allFees.map((f) => feeGrowth(f, btcDates[b])))]));
  return sectors.map((s, k) => {
    const phases = phaseSeries(s.index);
    const out = new Map<number, DayNarrative>();
    for (const b of testDays) {
      const fees = summarizeFees(sectorFees[k].map((f) => feeGrowth(f, btcDates[b])));
      const atSec = Date.parse(`${btcDates[b]}T00:00:00Z`) / 1000;
      const stage = narrativeStage(fees, marketByDay.get(b) as { g30: number | null; g90: number | null }, buildersAt(s, atSec, times), marketLaunchesAt(atSec, times));
      out.set(b, { sector: s.name, stage, strength: STAGE_STRENGTH[stage], attention: narrativeAttention(phases[b], readingAt(s.index, b)) });
    }
    return out;
  });
}

/** The coin's strongest narrative on test day `b`. */
export function coinNarrative(c: CoinSeries, stages: Map<number, DayNarrative>[], b: number): DayNarrative | null {
  let narrative: DayNarrative | null = null;
  for (const s of c.sectors) {
    const n = stages[s].get(b);
    if (n && (!narrative || n.strength > narrative.strength)) narrative = n;
  }
  return narrative;
}

/** Scorecard inputs for coin `c` on date `d` (its bar `i`), using only data available before that day. */
export function coinDayInputs(c: CoinSeries, d: string, i: number, narrative: DayNarrative | null): FaInputs {
  const price = c.closes[i];
  const f30 = c.fees ? windowSum(c.fees, d, 0, 30) : null;
  const hasFees = f30 !== null && f30 > 0;
  const g = hasFees && c.fees ? feeGrowth(c.fees, d) : { g30: null, g90: null };
  const share = (l: FlowLookup | null) => {
    if (!hasFees || !l) return null;
    const v = windowSum(l, d, 0, 30);
    return v === null ? null : Math.min(1, v / (f30 as number));
  };
  const holders30 = hasFees && c.holders ? windowSum(c.holders, d, 0, 30) : null;
  return {
    hasFees,
    feesExpected: c.feesExpected,
    feesGrowth30d: g.g30,
    feesGrowth90d: g.g90,
    feesAnnualized: hasFees ? (f30 as number) * (365 / 30) : null,
    tvlChange7d: null,
    // Same rule as live: fees but no holder payouts on record = holders get nothing.
    holderShare: hasFees ? (share(c.holders) ?? 0) : null,
    revenueShare: share(c.revenue),
    holdersRevenueAnnualized: holders30 !== null ? holders30 * (365 / 30) : null,
    circulatingRatio: null,
    inflation: null,
    fdvToMcap: null,
    // No unlock history: today's calendar only.
    unlocks90: null,
    category: null,
    categoryShare: null,
    categoryRank: null,
    categoryPeers: null,
    commits4w: null,
    devCommits12w: null,
    devTrend: null,
    contributors: null,
    governance90d: null,
    stablecoinChange30d: null,
    chainLaunches90d: null,
    // Days since the coin's first Binance price: a stand-in for its age.
    ageDays: i,
    audits: null,
    hacks: null,
    tier1: null,
    priceToFees: null,
    priceToSales: null,
    mcapToTvl: null,
    usageVsPrice: hasFees ? usageVsPrice(g.g90, price / c.closes[i - 90] - 1) : null,
    narrativeLoaded: true,
    narrative,
    ratings: null,
  };
}

// ---- Main ----

export async function runStrategyBacktest(opts: StrategyOptions, report: (p: JobProgress) => void): Promise<StrategyBacktestResult> {
  const started = Date.now();
  const h = opts.horizonDays;

  const data = await loadReplay(opts.maxCoins, MIN_AGE + h, report);
  const { coins, btcDates, btc } = data;
  report({ stage: "Scoring every coin, every 3 days", done: 0, total: 0 });

  const bullAt = btcBullAt(btc);
  const testDays: number[] = [];
  for (let b = 199; b + h < btcDates.length; b += STEP_DAYS) testDays.push(b);
  const stages = sectorStages(data, testDays);

  const obs: Obs[] = [];
  for (const b of testDays) {
    const d = btcDates[b];
    const btcFwd = btc[b + h] / btc[b] - 1;

    coins.forEach((c, k) => {
      const i = c.pos.get(d);
      if (i === undefined || i < MIN_AGE || (c.vol30[i] ?? 0) < MIN_LIQUIDITY) return;
      let exit: number;
      let delistedExit = false;
      if (i + h < c.closes.length) exit = c.closes[i + h];
      else if (c.pair.status === "BREAK") {
        exit = c.closes[c.closes.length - 1];
        delistedExit = true;
      } else return;

      const narrative = coinNarrative(c, stages, b);
      const inputs = coinDayInputs(c, d, i, narrative);
      const fa = scoreFundamentals(inputs, { evidenceBase: REPLAYED });
      const score = fa.score;
      if (score === null) return;
      obs.push({
        coin: k,
        t: b,
        score,
        ret: Math.min(MAX_RETURN, exit / c.closes[i] - 1) - opts.cost,
        btc: btcFwd,
        bull: bullAt(b),
        hasFees: inputs.hasFees,
        stage: narrative?.stage ?? null,
        attention: narrative?.attention ?? null,
        delistedExit,
        cats: fa.categories.map((c) => c.score),
        evid: fa.categories.map((c) => c.evidence),
        x: {
          score,
          feesGrowth90d: inputs.feesGrowth90d,
          feesGrowth30d: inputs.feesGrowth30d,
          feesAnnualized: inputs.feesAnnualized,
          holderShare: inputs.holderShare,
          usageVsPrice: inputs.usageVsPrice,
          narrativeStrength: narrative?.strength ?? null,
          ageDays: i,
        },
      });
    });
  }
  if (!obs.length) throw new Error("No coin had enough history to test. Try again once price history has loaded.");

  // Signals: score clears the bar, at most one open hold per coin (no overlapping holds).
  const nextAllowed = new Map<number, number>();
  const signals = obs.filter((o) => {
    if (o.score < opts.threshold || o.t < (nextAllowed.get(o.coin) ?? 0)) return false;
    nextAllowed.set(o.coin, o.t + h);
    return true;
  });

  const baseline = stats(obs);
  const sig = stats(signals);
  const range = baseline.avgReturn !== null ? edgeRange(signals, btcDates, baseline.avgReturn) : { low: null, high: null };

  const BUCKETS: [string, number, number][] = [
    ["Below 40", 0, 40],
    ["40–49", 40, 50],
    ["50–59", 50, 60],
    ["60–69", 60, 70],
    ["70+", 70, 101],
  ];
  const years = [...new Set(obs.map((o) => btcDates[o.t].slice(0, 4)))].sort();
  const STAGES: (NarrativeStage | null)[] = ["Emerging", "Accelerating", "Quiet", "Maturing", "Fading", null];
  const ATTENTION: NarrativeAttention[] = ["Unnoticed", "Noticed", "Crowded"];

  // Information coefficient: each day, rank-correlate a factor with what happened next; average over days.
  const byDay = new Map<number, Obs[]>();
  for (const o of obs) {
    const day = byDay.get(o.t);
    if (day) day.push(o);
    else byDay.set(o.t, [o]);
  }
  const factors = (Object.keys(FACTORS) as FactorKey[]).map((key) => {
    const ics: number[] = [];
    for (const day of byDay.values()) {
      const rows = day.filter((o) => o.x[key] !== null && Number.isFinite(o.x[key]));
      if (rows.length < MIN_CROSS_SECTION) continue;
      const ic = pearson(ranks(rows.map((o) => o.x[key] as number)), ranks(rows.map((o) => o.ret)));
      if (ic !== null) ics.push(ic);
    }
    return {
      key,
      label: FACTORS[key],
      ic: ics.length ? ics.reduce((a, b) => a + b, 0) / ics.length : null,
      positiveShare: ics.length ? ics.filter((v) => v > 0).length / ics.length : null,
      dates: ics.length,
    };
  });

  const delistedCoins = new Set(obs.filter((o) => coins[o.coin].pair.status === "BREAK").map((o) => o.coin));
  const delistedObs = obs.filter((o) => delistedCoins.has(o.coin));
  const totalWeight = CATEGORIES.reduce((s, c) => s + c.weight, 0);
  report({ stage: "Checking robustness (periods, weights, stage orderings)", done: 0, total: 0 });
  const validation = validate(obs, btcDates, opts);

  const notes = [
    "Within the replayed categories only some inputs have history: execution uses age only, valuation uses usage vs price only (P/F needs supply history).",
    "Narratives use today's sector lists. Coins that are big in a sector today are partly there because they did well, which flatters narrative stages in the past.",
    `A narrative's stage uses only fundamentals: fee growth vs the market (needs fee data for at least ${MIN_FEE_MEMBERS} of its coins) and new protocol launches around its coins. Attention (price vs BTC) is reported separately and never scored.`,
    "Only coins Binance listed are included. Coins Binance delisted are included up to their last day; a hold that runs past delisting exits at the last price.",
    "Privacy, payments, storage and DePIN coins without fees are scored as unknown rather than weak; which coins those are comes from today's sector lists.",
    "Prices and volumes are Binance spot. Fees come from DefiLlama, matched by ticker, so a few tickers may map to the wrong protocol.",
    "The score buckets count every coin every 3 days, so neighboring rows overlap. The signal stats use one hold at a time per coin.",
    `A single hold's return is capped at +${MAX_RETURN * 100}%, and a coin's history is cut at any overnight move over ${MAX_OVERNIGHT}× (redenominations, reused tickers), so a broken price series can't dominate the averages.`,
  ];
  if (sig.count < 30) notes.unshift(`Only ${sig.count} signals: too few to trust. Lower the threshold or widen the universe.`);

  const result: StrategyBacktestResult = {
    options: opts,
    period: { from: btcDates[obs[0].t], to: btcDates[obs[obs.length - 1].t] },
    coins: {
      tested: new Set(obs.map((o) => o.coin)).size,
      delisted: delistedCoins.size,
      withFees: new Set(obs.filter((o) => o.hasFees).map((o) => o.coin)).size,
      withNarrative: new Set(obs.filter((o) => o.stage).map((o) => o.coin)).size,
    },
    factorsUsed: CATEGORIES.filter((c) => REPLAYED.includes(c.key)).map((c) => c.label),
    factorsSkipped: CATEGORIES.filter((c) => !REPLAYED.includes(c.key)).map((c) => c.label),
    backtestedWeight: CATEGORIES.filter((c) => REPLAYED.includes(c.key)).reduce((s, c) => s + c.weight, 0) / totalWeight,
    baseline,
    signals: sig,
    edge: {
      avg: sig.avgReturn !== null && baseline.avgReturn !== null ? sig.avgReturn - baseline.avgReturn : null,
      ...range,
    },
    buckets: BUCKETS.map(([label, lo, hi]) => ({ label, stats: stats(obs.filter((o) => o.score >= lo && o.score < hi)) })),
    regimes: (["Bull", "Bear"] as const).map((regime) => ({
      regime,
      signals: stats(signals.filter((o) => o.bull === (regime === "Bull"))),
      baseline: stats(obs.filter((o) => o.bull === (regime === "Bull"))),
    })),
    years: years.map((year) => ({
      year,
      signals: stats(signals.filter((o) => btcDates[o.t].startsWith(year))),
      baseline: stats(obs.filter((o) => btcDates[o.t].startsWith(year))),
    })),
    phases: STAGES.map((stage) => ({ phase: stage ?? "No tracked narrative", stats: stats(obs.filter((o) => o.stage === stage)) })),
    attention: ATTENTION.map((label) => ({ label, stats: stats(obs.filter((o) => o.attention === label)) })),
    fa: [
      { label: "Fees tracked", stats: stats(obs.filter((o) => o.hasFees)) },
      { label: "No fees tracked", stats: stats(obs.filter((o) => !o.hasFees)) },
    ],
    factors,
    delisted: { coins: delistedCoins.size, observations: delistedObs.length, avgReturn: stats(delistedObs).avgReturn },
    recentSignals: signals
      .slice(-25)
      .reverse()
      .map((s) => ({ symbol: coins[s.coin].pair.base, date: btcDates[s.t], score: s.score, ret: s.ret, btc: s.btc, delistedExit: s.delistedExit })),
    notes,
    ranAt: new Date().toISOString(),
    validation,
    durationMs: Date.now() - started,
  };
  await setKv(LATEST_KEY, result);
  return result;
}

// ---- Validation: does the result survive other periods, weights and stage orderings? ----

/** Score, IC and signal stats for one way of scoring the same coin-days. */
function evaluate(label: string, obs: Obs[], scores: (number | null)[], opts: StrategyOptions, keep: (o: Obs) => boolean = () => true): ValidationRun {
  const rows = obs.map((o, i) => ({ o, s: scores[i] })).filter((r): r is { o: Obs; s: number } => r.s !== null && keep(r.o));
  const byDay = new Map<number, { s: number; ret: number }[]>();
  for (const r of rows) {
    const day = byDay.get(r.o.t);
    if (day) day.push({ s: r.s, ret: r.o.ret });
    else byDay.set(r.o.t, [{ s: r.s, ret: r.o.ret }]);
  }
  const ics: number[] = [];
  for (const day of byDay.values()) {
    if (day.length < MIN_CROSS_SECTION) continue;
    const ic = pearson(ranks(day.map((d) => d.s)), ranks(day.map((d) => d.ret)));
    if (ic !== null) ics.push(ic);
  }
  const nextAllowed = new Map<number, number>();
  const signals = rows.filter((r) => {
    if (r.s < opts.threshold || r.o.t < (nextAllowed.get(r.o.coin) ?? 0)) return false;
    nextAllowed.set(r.o.coin, r.o.t + opts.horizonDays);
    return true;
  });
  const sig = stats(signals.map((r) => r.o));
  const base = stats(rows.map((r) => r.o));
  return {
    label,
    ic: ics.length ? ics.reduce((a, b) => a + b, 0) / ics.length : null,
    positiveShare: ics.length ? ics.filter((v) => v > 0).length / ics.length : null,
    signals: sig,
    baseline: base,
    edge: sig.avgReturn !== null && base.avgReturn !== null && sig.count >= 10 ? sig.avgReturn - base.avgReturn : null,
  };
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1) + 0.5))];
};

function validate(obs: Obs[], dates: string[], opts: StrategyOptions): StrategyValidation {
  const keys = CATEGORIES.map((c) => c.key);
  const baseWeights = CATEGORIES.map((c) => c.weight);
  const narr = keys.indexOf("narrative");
  const rescore = (weights: number[], strength?: Record<NarrativeStage, number>) =>
    obs.map((o) =>
      combineCategories(
        keys.map((key, k) => ({ key, weight: weights[k], score: k === narr && strength && o.stage ? strength[o.stage] : o.cats[k], evidence: o.evid[k] })),
        REPLAYED,
      ).score,
    );
  const baseScores = obs.map((o) => o.score);
  const dateOf = (o: Obs) => dates[o.t];
  const span = (keep: (o: Obs) => boolean) => {
    const ds = obs.filter(keep).map(dateOf);
    return { from: ds[0] ?? "", to: ds[ds.length - 1] ?? "" };
  };

  const early = (o: Obs) => dateOf(o) < PERIOD_SPLIT;
  const late = (o: Obs) => dateOf(o) >= PERIOD_SPLIT;
  const afterFreeze = (o: Obs) => dateOf(o) >= RULES_FROZEN_AT;
  const periods = [
    { ...evaluate(`Before ${PERIOD_SPLIT.slice(0, 4)}`, obs, baseScores, opts, early), ...span(early) },
    { ...evaluate(`${PERIOD_SPLIT.slice(0, 4)} onward`, obs, baseScores, opts, late), ...span(late) },
    { ...evaluate(`After the rules were frozen (${RULES_FROZEN_AT})`, obs, baseScores, opts, afterFreeze), ...span(afterFreeze) },
  ];

  const leaveOneOut = CATEGORIES.filter((c) => REPLAYED.includes(c.key)).map((c) => {
    const w = baseWeights.map((x, k) => (keys[k] === c.key ? 0 : x));
    return evaluate(`Without ${c.label}`, obs, rescore(w), opts);
  });

  const rand = mulberry32(7);
  const randomRuns: ValidationRun[] = [];
  for (let r = 0; r < RANDOM_WEIGHT_RUNS; r++) {
    const w = baseWeights.map((x) => x * (0.5 + rand()));
    randomRuns.push(evaluate(`Random weights ${r + 1}`, obs, rescore(w), opts));
  }
  const ics = randomRuns.flatMap((r) => (r.ic === null ? [] : [r.ic]));
  const edges = randomRuns.flatMap((r) => (r.edge === null ? [] : [r.edge]));

  // Baselines: does the scorecard beat simpler rules? Each picks the same share of coin-days as the score does at its threshold.
  const pickShare = baseScores.filter((s) => s >= opts.threshold).length / baseScores.length;
  const against = (label: string, scores: (number | null)[]) => {
    const known = scores.filter((s): s is number => s !== null);
    const cutoff = quantile(known, 1 - pickShare) ?? Infinity;
    return evaluate(label, obs, scores, { ...opts, threshold: cutoff });
  };
  const exec = keys.indexOf("execution");
  const baselines = [
    evaluate("Fundamental score", obs, baseScores, opts),
    against("Age only (older coins first)", obs.map((o) => o.x.ageDays)),
    against("Fees tracked or not (yes/no)", obs.map((o) => (o.hasFees ? 1 : 0))),
    against("Score without age (execution removed)", rescore(baseWeights.map((x, k) => (k === exec ? 0 : x)))),
  ];

  const noNarrative = baseWeights.map((x, k) => (k === narr ? 0 : x));
  const stageVariants = [
    evaluate("Current order (Accelerating first)", obs, baseScores, opts),
    evaluate("Original order (Emerging first), before tuning", obs, rescore(baseWeights, ORIGINAL_STAGE_STRENGTH), opts),
    evaluate("No narrative category at all", obs, rescore(noNarrative), opts),
  ];

  return {
    frozenAt: RULES_FROZEN_AT,
    periods,
    leaveOneOut,
    randomWeights: {
      runs: RANDOM_WEIGHT_RUNS,
      icMin: quantile(ics, 0),
      icMedian: quantile(ics, 0.5),
      icMax: quantile(ics, 1),
      edgeMin: quantile(edges, 0),
      edgeMedian: quantile(edges, 0.5),
      edgeMax: quantile(edges, 1),
      positiveEdgeShare: edges.length ? edges.filter((e) => e > 0).length / edges.length : null,
    },
    stageVariants,
    baselines,
    pickShare,
    beyondAge: partialIc(obs, baseScores, (o) => o.x.ageDays),
  };
}

/**
 * The score's daily rank correlation with returns once age is held constant (partial correlation):
 * what the scorecard knows that "older coins do better" doesn't.
 */
function partialIc(obs: Obs[], scores: number[], control: (o: Obs) => number | null): { ic: number | null; positiveShare: number | null } {
  const byDay = new Map<number, { s: number; c: number; ret: number }[]>();
  obs.forEach((o, i) => {
    const c = control(o);
    if (c === null) return;
    const row = { s: scores[i], c, ret: o.ret };
    const day = byDay.get(o.t);
    if (day) day.push(row);
    else byDay.set(o.t, [row]);
  });
  const ics: number[] = [];
  for (const day of byDay.values()) {
    if (day.length < MIN_CROSS_SECTION) continue;
    const s = ranks(day.map((d) => d.s));
    const c = ranks(day.map((d) => d.c));
    const r = ranks(day.map((d) => d.ret));
    const sr = pearson(s, r);
    const sc = pearson(s, c);
    const cr = pearson(c, r);
    if (sr === null || sc === null || cr === null || Math.abs(sc) >= 1 || Math.abs(cr) >= 1) continue;
    ics.push((sr - sc * cr) / Math.sqrt((1 - sc ** 2) * (1 - cr ** 2)));
  }
  return { ic: ics.length ? ics.reduce((a, b) => a + b, 0) / ics.length : null, positiveShare: ics.length ? ics.filter((v) => v > 0).length / ics.length : null };
}
