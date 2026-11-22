// Pure time-series math over daily price points: indicators, snapshots,
// rally detection, technicals and supply inflation.

import type { PricePoint, Rally, Snapshot, Technicals } from "@/lib/types";

/** Minimum low → peak gain to count as a rally. */
export const MIN_RALLY_GAIN = 0.2;
/** How far back to look for the rally. */
export const RALLY_WINDOW_DAYS = 90;
/** Window for the "distance from high" setup metric. */
const HIGH_WINDOW_DAYS = 180;

/** Benchmark close keyed by date, for relative-strength comparisons. */
export type BenchmarkCloses = Map<string, number>;

interface Indicators {
  closes: number[];
  vols: number[];
  /** Prefix sums for O(1) moving averages. */
  closeSum: number[];
  volSum: number[];
  rsi: (number | null)[];
  macdHist: (number | null)[];
}

const cache = new WeakMap<PricePoint[], Indicators>();

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

function indicators(series: PricePoint[]): Indicators {
  const hit = cache.get(series);
  if (hit) return hit;

  const closes = series.map((p) => p.price);
  const vols = series.map((p) => p.volume);
  const prefix = (xs: number[]) => xs.reduce<number[]>((acc, x, i) => (acc.push((acc[i - 1] ?? 0) + x), acc), []);

  // Wilder's RSI(14)
  const rsi: (number | null)[] = closes.map(() => null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= 14) {
      gain += g / 14;
      loss += l / 14;
    } else {
      gain = (gain * 13 + g) / 14;
      loss = (loss * 13 + l) / 14;
    }
    if (i >= 14) rsi[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }

  // MACD(12, 26, 9) histogram, scaled by price so coins are comparable
  const ema26 = ema(closes, 26);
  const macd = ema(closes, 12).map((v, i) => v - ema26[i]);
  const signal = ema(macd, 9);
  const macdHist = closes.map((c, i) => (i >= 33 ? (macd[i] - signal[i]) / c : null));

  const ind = { closes, vols, closeSum: prefix(closes), volSum: prefix(vols), rsi, macdHist };
  cache.set(series, ind);
  return ind;
}

/** Mean of xs[from..to] using a prefix-sum array. */
function rangeMean(sum: number[], from: number, to: number): number | null {
  if (from < 0 || to < from) return null;
  return (sum[to] - (from > 0 ? sum[from - 1] : 0)) / (to - from + 1);
}

/**
 * Benchmark close on a date, or the closest earlier one within 3 days: the coin's
 * and the benchmark's charts may be cached at different times around midnight.
 */
export function benchAt(bench: BenchmarkCloses, date: string): number | undefined {
  const t = Date.parse(`${date}T00:00:00Z`);
  for (let back = 0; back <= 3; back++) {
    const v = bench.get(new Date(t - back * 86_400_000).toISOString().slice(0, 10));
    if (v) return v;
  }
  return undefined;
}

function relReturn(series: PricePoint[], i: number, lookback: number, bench: BenchmarkCloses): number | null {
  if (i < lookback) return null;
  const b1 = benchAt(bench, series[i].date);
  const b0 = benchAt(bench, series[i - lookback].date);
  if (!b1 || !b0) return null;
  return series[i].price / series[i - lookback].price - 1 - (b1 / b0 - 1);
}

export function snapshotAt(series: PricePoint[], i: number, bench: BenchmarkCloses): Snapshot {
  const { closes, closeSum, volSum, rsi, macdHist } = indicators(series);
  const point = series[i];
  const price = point.price;

  const avg7 = i >= 6 ? rangeMean(volSum, i - 6, i) : null;
  const prior30 = i >= 36 ? rangeMean(volSum, i - 36, i - 7) : null;
  const sma = (n: number) => (i >= n - 1 ? rangeMean(closeSum, i - n + 1, i) : null);
  const sma20 = sma(20);
  const sma50 = sma(50);
  const sma200 = sma(200);
  const high = Math.max(...closes.slice(Math.max(0, i - HIGH_WINDOW_DAYS + 1), i + 1));

  return {
    date: point.date,
    price,
    marketCap: point.marketCap,
    volTrend: avg7 !== null && prior30 ? avg7 / prior30 : null,
    turnover: avg7 !== null && point.marketCap ? avg7 / point.marketCap : null,
    vsSma20: sma20 ? price / sma20 - 1 : null,
    vsSma50: sma50 ? price / sma50 - 1 : null,
    fromHigh: high > 0 ? price / high - 1 : null,
    relStrength14d: relReturn(series, i, 14, bench),
    return30d: i >= 30 ? price / closes[i - 30] - 1 : null,
    rsi14: rsi[i],
    macdHist: macdHist[i],
    vsSma200: sma200 ? price / sma200 - 1 : null,
  };
}

/**
 * Finds the biggest low → peak run inside the last RALLY_WINDOW_DAYS, and the
 * breakout day: the first close above the 20-day average after the low.
 */
export function detectRally(series: PricePoint[], bench: BenchmarkCloses): { rally: Rally; breakoutIndex: number } | null {
  const { closes, closeSum, volSum } = indicators(series);
  const n = closes.length;
  const start = Math.max(0, n - RALLY_WINDOW_DAYS);

  let peak = start;
  for (let i = start; i < n; i++) if (closes[i] > closes[peak]) peak = i;
  let low = start;
  for (let i = start; i <= peak; i++) if (closes[i] < closes[low]) low = i;

  const gain = closes[peak] / closes[low] - 1;
  if (peak === low || gain < MIN_RALLY_GAIN) return null;

  let breakout = Math.min(low + 1, peak);
  for (let i = low + 1; i <= peak; i++) {
    const sma20 = rangeMean(closeSum, Math.max(0, i - 19), i);
    if (sma20 !== null && closes[i] > sma20) {
      breakout = i;
      break;
    }
  }

  const runVol = rangeMean(volSum, breakout, peak);
  const baseVol = low >= 5 ? rangeMean(volSum, Math.max(0, low - 30), low - 1) : null;
  const bLow = benchAt(bench, series[low].date);
  const bPeak = benchAt(bench, series[peak].date);

  return {
    breakoutIndex: breakout,
    rally: {
      lowDate: series[low].date,
      lowPrice: closes[low],
      peakDate: series[peak].date,
      peakPrice: closes[peak],
      gain,
      days: peak - low,
      breakoutDate: series[breakout].date,
      breakoutPrice: closes[breakout],
      volumeRatio: runVol !== null && baseVol ? runVol / baseVol : null,
      benchmarkGain: bLow && bPeak ? bPeak / bLow - 1 : null,
      fromPeakNow: closes[n - 1] / closes[peak] - 1,
    },
  };
}

/**
 * The biggest low → high run inside the last `windowDays` (the largest gain
 * from a running low), and its breakout: the first close above the 20-day
 * average after the low. Null when no run reaches `minGain`.
 */
export function biggestRun(series: PricePoint[], windowDays: number, minGain: number): { lowIndex: number; peakIndex: number; breakoutIndex: number; gain: number } | null {
  const { closes, closeSum } = indicators(series);
  const n = closes.length;
  const start = Math.max(0, n - windowDays);
  let low = start;
  let best = { gain: 0, low: start, peak: start };
  for (let i = start; i < n; i++) {
    if (closes[i] < closes[low]) low = i;
    const gain = closes[i] / closes[low] - 1;
    if (gain > best.gain) best = { gain, low, peak: i };
  }
  if (best.gain < minGain) return null;
  let breakout = Math.min(best.low + 1, best.peak);
  for (let i = best.low + 1; i <= best.peak; i++) {
    const sma20 = rangeMean(closeSum, Math.max(0, i - 19), i);
    if (sma20 !== null && closes[i] > sma20) {
      breakout = i;
      break;
    }
  }
  return { lowIndex: best.low, peakIndex: best.peak, breakoutIndex: breakout, gain: best.gain };
}

export interface Run {
  lowIndex: number;
  peakIndex: number;
  breakoutIndex: number;
  gain: number;
}

/**
 * Every separate run in a series: a rise of at least `minGain` from a low,
 * ended by a fall of `endDrawdown` from its peak (or still going at the end).
 * Runs don't overlap; the next one starts from the low after the previous peak.
 */
export function findRuns(series: PricePoint[], minGain = 0.5, endDrawdown = 0.3): Run[] {
  const { closes, closeSum } = indicators(series);
  const runs: Run[] = [];
  let low = 0;
  let peak = 0;
  const close = (lo: number, pk: number) => {
    let breakout = Math.min(lo + 1, pk);
    for (let i = lo + 1; i <= pk; i++) {
      const sma20 = rangeMean(closeSum, Math.max(0, i - 19), i);
      if (sma20 !== null && closes[i] > sma20) {
        breakout = i;
        break;
      }
    }
    runs.push({ lowIndex: lo, peakIndex: pk, breakoutIndex: breakout, gain: closes[pk] / closes[lo] - 1 });
  };
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[peak]) peak = i;
    // A big enough fall from the peak ends the current run (checked first, so a crash below the low still records it).
    if (peak > low && closes[i] <= closes[peak] * (1 - endDrawdown)) {
      if (closes[peak] / closes[low] - 1 >= minGain) close(low, peak);
      low = peak = i;
      continue;
    }
    if (closes[i] < closes[low]) low = peak = i;
  }
  if (peak > low && closes[peak] / closes[low] - 1 >= minGain) close(low, peak);
  return runs;
}

/** Annualized volatility of daily log returns over the last `days`. */
export function volatility(series: PricePoint[], days: number): number | null {
  if (series.length < days + 1) return null;
  const closes = series.slice(-(days + 1)).map((p) => p.price);
  const rets = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
  const avg = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - avg) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(365);
}

export function technicals(series: PricePoint[], bench: BenchmarkCloses): Technicals {
  const { closes, closeSum, rsi, macdHist } = indicators(series);
  const n = closes.length;
  const i = n - 1;
  const price = closes[i];
  const ret = (days: number) => (n > days ? price / closes[i - days] - 1 : null);
  const sma = (len: number) => (n >= len ? rangeMean(closeSum, i - len + 1, i) : null);
  const sma50 = sma(50);
  const sma200 = sma(200);

  let peak = closes[0];
  let maxDrawdown = 0;
  for (const c of closes) {
    peak = Math.max(peak, c);
    maxDrawdown = Math.min(maxDrawdown, c / peak - 1);
  }
  const yearLookback = Math.min(365, n - 1);

  return {
    rsi14: rsi[i],
    macdHist: macdHist[i],
    macdRising: macdHist[i] !== null && i >= 3 && macdHist[i - 3] !== null ? (macdHist[i] as number) > (macdHist[i - 3] as number) : null,
    sma50vs200: sma50 && sma200 ? sma50 / sma200 - 1 : null,
    vsSma200: sma200 ? price / sma200 - 1 : null,
    return7d: ret(7),
    return90d: ret(90),
    return1y: n >= 330 ? price / closes[i - yearLookback] - 1 : null,
    relStrength30d: relReturn(series, i, 30, bench),
    relStrength90d: relReturn(series, i, 90, bench),
    relStrength1y: n >= 330 ? relReturn(series, i, yearLookback, bench) : null,
    maxDrawdown1y: n >= 30 ? maxDrawdown : null,
    volatility90d: volatility(series, 90),
    fromHigh52w: price / Math.max(...closes) - 1,
    fromLow52w: price / Math.min(...closes) - 1,
  };
}

/**
 * Annualized growth of circulating supply, inferred from market cap ÷ price
 * now vs ~90 days ago. Implausible jumps (data corrections) return null.
 */
export function supplyInflation(series: PricePoint[]): number | null {
  const n = series.length;
  if (n < 91) return null;
  const supply = (p: PricePoint) => (p.marketCap && p.price > 0 ? p.marketCap / p.price : null);
  const now = supply(series[n - 1]);
  const then = supply(series[n - 91]);
  if (!now || !then) return null;
  const annual = (now / then) ** (365 / 90) - 1;
  return annual > -0.5 && annual < 5 ? annual : null;
}
