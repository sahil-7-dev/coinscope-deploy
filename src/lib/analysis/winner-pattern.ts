// Winner patterns: a benchmark's fundamentals on the day one of its runs began
// (or any date you choose), so candidates are compared with what the winner
// looked like *before* it ran (the setup), not after (the result). The peak
// is kept separately as hindsight.
//
// Point in time: fees, revenue and holder revenue come from DefiLlama's daily
// history up to the day before; market cap and supply from the coin's chart.
// The chart is CoinGecko's last year (with market cap) extended back to 2021
// with Binance prices; before CoinGecko's year, market cap is estimated from
// today's circulating supply and supply-based metrics are left out (flagged).
// TVL, listings and developer activity have no cheap history and stay empty.

import { flowSeries, getFundamentals, type FlowSeries, type FlowType } from "@/lib/providers/defillama";
import { cachedPersistent, MINUTE } from "@/lib/server/cache";
import { longBars } from "@/lib/server/history";
import type { CoinProfile, NarrativesResponse, PricePoint } from "@/lib/types";
import { latestNarratives, narrativeAt } from "./narratives";
import { findRuns, type Run } from "./series";
import type { FundamentalSnapshot } from "./similarity";

/** A run has to be at least this big to count as a winner's move. */
const MIN_RUN = 0.5;
const DAY = 86_400_000;
const ANNUALIZE_30D = 365 / 30;

export interface WinnerRun {
  lowDate: string;
  breakoutDate: string;
  peakDate: string;
  gain: number;
  /** Before CoinGecko's year of market-cap data: market cap and P/F are estimates. */
  approx: boolean;
}

export interface PreMove {
  id: string;
  run: WinnerRun | null;
  /** Fundamentals the day before the run's breakout, or the day before your chosen date. */
  before: FundamentalSnapshot | null;
  /** Fundamentals at the run's peak: hindsight, not known before the run. */
  atPeak: FundamentalSnapshot | null;
  /** You picked this date (rather than the default run). */
  custom: boolean;
  note: string | null;
}

export interface WinnerDetail extends PreMove {
  /** Every run since 2021, newest first. */
  runs: WinnerRun[];
}

const dayBefore = (date: string, days = 1) => new Date(Date.parse(`${date}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);

/** Sum of a daily series over `days` days ending on `end` (inclusive), or null when the history doesn't reach back. */
function windowSum(s: FlowSeries | null, end: string, days: number): number | null {
  if (!s) return null;
  const pos = s.dates.indexOf(end);
  if (pos < 0 || pos - days + 1 < 0) return null;
  let sum = 0;
  for (let i = pos - days + 1; i <= pos; i++) sum += s.values[i];
  return sum;
}

const growth = (now: number | null, before: number | null) => (now !== null && before ? now / before - 1 : null);

/** Annualized supply growth over 90 days; implausible jumps (data corrections) give null. */
function annualInflation(supply: number | null, supply90dAgo: number | null): number | null {
  if (!supply || !supply90dAgo) return null;
  const annual = (supply / supply90dAgo) ** (365 / 90) - 1;
  return annual > -0.5 && annual < 5 ? annual : null;
}

/**
 * The coin's chart: CoinGecko's year (with market cap), extended back with
 * Binance prices when the ticker matches. Older points estimate market cap
 * from today's circulating supply.
 */
async function fullSeries(p: CoinProfile): Promise<{ series: PricePoint[]; exactFrom: string | null }> {
  const recent = p.series ?? [];
  const exactFrom = recent[0]?.date ?? null;
  const long = await longBars(p.symbol).catch(() => null);
  const last = long?.[long.length - 1]?.close;
  // Two coins can share a ticker: only use Binance history if its price matches.
  if (!long || !last || !p.price || Math.abs(last / p.price - 1) > 0.3 || !exactFrom) return { series: recent, exactFrom };
  const circulating = p.supply.circulating;
  const older = long
    .filter((b) => b.date < exactFrom)
    .map((b) => ({ date: b.date, price: b.close, volume: b.volume, marketCap: circulating ? b.close * circulating : null }));
  return { series: [...older, ...recent], exactFrom };
}

interface Flows {
  fees: FlowSeries | null;
  revenue: FlowSeries | null;
  holders: FlowSeries | null;
}

async function flowsFor(p: CoinProfile): Promise<Flows> {
  const slug = p.fundamentals?.slug ?? (await getFundamentals(p.id, p.marketCap, p.name).catch(() => null))?.slug ?? null;
  if (!slug) return { fees: null, revenue: null, holders: null };
  const [fees, revenue, holders] = await Promise.all((["dailyFees", "dailyRevenue", "dailyHoldersRevenue"] as FlowType[]).map((t) => flowSeries(slug, t).catch(() => null)));
  return { fees, revenue, holders };
}

/** Fundamentals as known on the day before `series[i]`. */
function snapshotAt(p: CoinProfile, series: PricePoint[], i: number, exactFrom: string | null, flows: Flows, narratives: NarrativesResponse | null): FundamentalSnapshot {
  const at = series[i];
  const asOf = dayBefore(at.date);
  const exact = !!exactFrom && at.date >= exactFrom;
  const { fees, revenue, holders } = flows;

  const fees30 = windowSum(fees, asOf, 30);
  const hasFees = fees30 !== null && fees30 > 0;
  const rev30 = hasFees ? windowSum(revenue, asOf, 30) : null;
  const holders30 = hasFees ? windowSum(holders, asOf, 30) : null;
  const feesBack = (offset: number, days: number) => windowSum(fees, dayBefore(asOf, offset), days);

  const mcap = at.marketCap;
  // Supply only comes from the chart where market cap is real (CoinGecko's year).
  const supply = exact && mcap && at.price > 0 ? mcap / at.price : null;
  const then = series[i - 90];
  const supplyThen = exact && then?.marketCap && then.price > 0 && then.date >= (exactFrom as string) ? then.marketCap / then.price : null;
  const maxSupply = p.supply.max ?? p.supply.total;
  const daysAgo = Math.round((Date.now() - Date.parse(`${at.date}T00:00:00Z`)) / DAY);
  const narrative = narrativeAt(narratives, p.categories, at.date);

  return {
    id: p.id,
    name: p.name,
    symbol: p.symbol,
    asOf,
    hasFees,
    fees30d: hasFees ? fees30 : null,
    feesGrowth30d: hasFees ? growth(fees30, feesBack(30, 30)) : null,
    feesGrowth90d: hasFees ? growth(windowSum(fees, asOf, 90), feesBack(90, 90)) : null,
    revenueGrowth90d: hasFees ? growth(windowSum(revenue, asOf, 90), windowSum(revenue, dayBefore(asOf, 90), 90)) : null,
    tvl: null,
    commits4w: null,
    holderShare: hasFees ? (holders30 !== null ? Math.min(1, holders30 / (fees30 as number)) : 0) : null,
    revenueShare: rev30 !== null && hasFees ? Math.min(1, rev30 / (fees30 as number)) : null,
    priceToFees: hasFees && mcap ? mcap / ((fees30 as number) * ANNUALIZE_30D) : null,
    priceToSales: mcap && rev30 ? mcap / (rev30 * ANNUALIZE_30D) : null,
    mcapToTvl: null,
    circulatingRatio: supply && maxSupply ? Math.min(1, supply / maxSupply) : null,
    inflation: annualInflation(supply, supplyThen),
    fdvToMcap: supply && maxSupply ? Math.max(1, maxSupply / supply) : null,
    marketCap: mcap,
    ageDays: p.ageDays !== null ? Math.max(0, p.ageDays - daysAgo) : null,
    tier1: null,
    categories: p.categories,
    narrativeSector: narrative?.sector ?? null,
    narrativeStage: narrative?.stage ?? null,
    approx: exact ? [] : ["Market cap and P/F are estimated from today's circulating supply (no market-cap history this far back); supply metrics are left out."],
  };
}

const toRun = (series: PricePoint[], r: Run, exactFrom: string | null): WinnerRun => ({
  lowDate: series[r.lowIndex].date,
  breakoutDate: series[r.breakoutIndex].date,
  peakDate: series[r.peakIndex].date,
  gain: r.gain,
  approx: !exactFrom || series[r.breakoutIndex].date < exactFrom,
});

const noFeesNote = (snap: FundamentalSnapshot | null) =>
  snap && !snap.hasFees ? "No fee history on DefiLlama for that date, so only supply, size and narrative can be compared." : null;

async function compute(p: CoinProfile, chosen: string | null): Promise<WinnerDetail> {
  const { series, exactFrom } = await fullSeries(p);
  if (series.length < 120) return { id: p.id, runs: [], run: null, before: null, atPeak: null, custom: false, note: "Not enough price history." };
  const found = findRuns(series, MIN_RUN);
  const runs = found.map((r) => toRun(series, r, exactFrom)).reverse();
  const [flows, narratives] = await Promise.all([flowsFor(p), latestNarratives()]);

  if (chosen) {
    // Your date is treated like a breakout day: the comparison uses what was known the day before.
    let i = series.findIndex((x) => x.date >= chosen);
    if (i < 0) i = series.length - 1;
    const match = found.find((r) => r.breakoutIndex === i);
    const before = snapshotAt(p, series, Math.max(1, i), exactFrom, flows, narratives);
    return {
      id: p.id,
      runs,
      run: match ? toRun(series, match, exactFrom) : null,
      before,
      atPeak: match ? snapshotAt(p, series, match.peakIndex, exactFrom, flows, narratives) : null,
      custom: true,
      note: noFeesNote(before),
    };
  }

  // Default: the biggest run that began in the last year, else the most recent run.
  const yearAgo = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10);
  const pick = found.filter((r) => series[r.breakoutIndex].date >= yearAgo).sort((a, b) => b.gain - a.gain)[0] ?? found[found.length - 1];
  if (!pick) return { id: p.id, runs, run: null, before: null, atPeak: null, custom: false, note: `No run of ${MIN_RUN * 100}%+ since 2021, so it's compared as it is today.` };
  const before = snapshotAt(p, series, pick.breakoutIndex, exactFrom, flows, narratives);
  return {
    id: p.id,
    runs,
    run: toRun(series, pick, exactFrom),
    before,
    atPeak: snapshotAt(p, series, pick.peakIndex, exactFrom, flows, narratives),
    custom: false,
    note: noFeesNote(before),
  };
}

/** A winner's runs and its fundamentals before the chosen (or default) one, cached for a day per choice. */
export function winnerDetail(p: CoinProfile, chosen: string | null): Promise<WinnerDetail | null> {
  return cachedPersistent(`winner:v1:${p.id}:${chosen ?? "default"}:${new Date().toISOString().slice(0, 10)}`, 24 * 60 * MINUTE, () => compute(p, chosen));
}

/** What Coin Check needs: the comparison snapshots, without the list of runs. */
export async function preMove(p: CoinProfile, chosen: string | null = null): Promise<PreMove | null> {
  const d = await winnerDetail(p, chosen);
  return d ? { id: d.id, run: d.run, before: d.before, atPeak: d.atPeak, custom: d.custom, note: d.note } : null;
}
