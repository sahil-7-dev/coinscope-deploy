// Backtest a checklist: replay each coin's past year day by day, score it with
// the checklist's chart-based criteria, and measure what happened after the
// days it scored high. Compared against every day (the "buy at random" baseline).

import type { AssetProvider } from "@/lib/providers/types";
import type { BacktestResponse, BacktestSignal, BacktestStats, Checklist, PricePoint } from "@/lib/types";
import { describeItem, METRICS, passes } from "./checklist";
import { HISTORY_DAYS } from "./profile";
import { snapshotAt, type BenchmarkCloses } from "./series";

const STEP_DAYS = 2;
/** After a signal, skip this many days for the same coin so one run isn't counted many times. */
const COOLDOWN_DAYS = 14;
/** Indicators need this much history before the first test day. */
const WARMUP_DAYS = 60;

function stats(returns: { r: number; b: number | null }[]): BacktestStats {
  if (!returns.length) return { count: 0, avgReturn: null, medianReturn: null, winRate: null, beatBenchmarkRate: null };
  const rs = returns.map((x) => x.r).sort((a, b) => a - b);
  const withBench = returns.filter((x) => x.b !== null);
  const mid = Math.floor(rs.length / 2);
  return {
    count: rs.length,
    avgReturn: rs.reduce((a, b) => a + b, 0) / rs.length,
    medianReturn: rs.length % 2 ? rs[mid] : (rs[mid - 1] + rs[mid]) / 2,
    winRate: rs.filter((r) => r > 0).length / rs.length,
    beatBenchmarkRate: withBench.length ? withBench.filter((x) => x.r > (x.b as number)).length / withBench.length : null,
  };
}

export async function runBacktest(
  provider: AssetProvider,
  checklist: Checklist,
  ids: string[],
  horizonDays: number,
  threshold: number,
  names: Record<string, string> = {},
): Promise<BacktestResponse> {
  const enabled = checklist.items.filter((i) => i.enabled);
  // Only chart-based metrics have history; supply/fundamentals/listings are known for today only.
  const usable = enabled.filter((i) => i.kind === "metric" && METRICS[i.metric].timing === "setup");
  const skipped = enabled.filter((i) => !usable.includes(i));

  const benchBars = await provider.getDailyBars(provider.benchmarkId, HISTORY_DAYS);
  const bench: BenchmarkCloses = new Map(benchBars.map((b) => [b.date, b.close]));

  const signals: BacktestSignal[] = [];
  const all: { r: number; b: number | null }[] = [];
  const errors: BacktestResponse["errors"] = [];
  const tested: string[] = [];

  const loaded = await Promise.allSettled(ids.map((id) => provider.getDailyBars(id, HISTORY_DAYS)));
  loaded.forEach((res, k) => {
    const id = ids[k];
    if (res.status === "rejected") {
      errors.push({ id, message: res.reason instanceof Error ? res.reason.message : String(res.reason) });
      return;
    }
    const series: PricePoint[] = res.value.map((b) => ({ date: b.date, price: b.close, volume: b.volume, marketCap: b.marketCap }));
    if (series.length < WARMUP_DAYS + horizonDays + 5) {
      errors.push({ id, message: "not enough history" });
      return;
    }
    tested.push(id);
    const name = names[id] ?? checklist.winners.find((w) => w.id === id)?.name ?? id;

    let cooldownUntil = -1;
    for (let i = WARMUP_DAYS; i + horizonDays < series.length; i += STEP_DAYS) {
      const snap = snapshotAt(series, i, bench);
      let known = 0;
      let passed = 0;
      let total = 0;
      for (const item of usable) {
        if (item.kind !== "metric") continue;
        const def = METRICS[item.metric];
        if (def.timing !== "setup") continue;
        total += item.weight;
        const v = def.snap(snap);
        if (v === null || !Number.isFinite(v)) continue;
        known += item.weight;
        if (passes(item.op, v, item.threshold)) passed += item.weight;
      }

      const fwd = series[i + horizonDays].price / series[i].price - 1;
      const b0 = bench.get(series[i].date);
      const b1 = bench.get(series[i + horizonDays].date);
      const bRet = b0 && b1 ? b1 / b0 - 1 : null;
      all.push({ r: fwd, b: bRet });

      const score = known ? Math.round((passed / known) * 100) : 0;
      if (i >= cooldownUntil && total && known / total >= 0.5 && score >= threshold) {
        signals.push({ coinId: id, coinName: name, date: series[i].date, score, forwardReturn: fwd, benchmarkReturn: bRet });
        cooldownUntil = i + COOLDOWN_DAYS;
      }
    }
  });

  return {
    horizonDays,
    threshold,
    coinsTested: tested,
    criteriaUsed: usable.map((i) => describeItem(i).label),
    criteriaSkipped: skipped.map((i) => describeItem(i).label),
    signals: signals.sort((a, b) => b.date.localeCompare(a.date)),
    stats: stats(signals.map((s) => ({ r: s.forwardReturn, b: s.benchmarkReturn }))),
    baseline: stats(all),
    errors,
  };
}
