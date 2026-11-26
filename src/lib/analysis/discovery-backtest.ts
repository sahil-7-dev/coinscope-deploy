// Runs the early-discovery test (docs/early-discovery-methodology.md, v1.0) for H0, the
// frozen fundamental score, on real history. The panel is scored with the strategy
// backtest's own replay code (loadReplay / coinDayInputs / scoreFundamentals), so the
// scores are the frozen H0 scores, not a re-implementation. The mechanics are in discovery.ts.

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getKv, setKv } from "@/lib/server/db";
import type { JobProgress } from "@/lib/server/jobs";
import { scoreFundamentals } from "./fundamentals";
import { discoveryVerdict, PRIMARY, runTest, SECONDARY, type Criterion, type DiscoveryEvent, type Panel, type Rule, type RunRecord, type TestDay, type TestResult, type VerdictKind } from "./discovery";
import { renderDiscoveryMarkdown } from "./discovery-report";
import { btcBullAt, coinDayInputs, coinNarrative, loadReplay, MIN_AGE, MIN_LIQUIDITY, REPLAYED, RULES_FROZEN_AT, sectorStages, STEP_DAYS } from "./strategy-backtest";

export const DISCOVERY_KEY = "discovery:h0:latest";
export const METHODOLOGY = { file: "docs/early-discovery-methodology.md", version: "1.0", frozenAt: "06e3402f5edc0477f25caa051b77877f70e2c129" };
/** §5: H0 flags a coin at score ≥ 60. ≥ 65 is reported for information only. */
export const H0_THRESHOLD = 60;
const SENSITIVITY_THRESHOLD = 65;
/** §3: the existing backtest's universe, run for information only. */
const TOP_N = 300;

export type SerializedEvent = Omit<DiscoveryEvent, "baseOutcomes">;
export type SerializedTest = Omit<TestResult, "eventRows" | "runRows"> & { eventRows: SerializedEvent[]; runRows: RunRecord[] };

export interface DiscoveryConfig {
  key: string;
  label: string;
  /** Only the decisive configuration gets a verdict; the others are information. */
  decisive: boolean;
  rule: string;
  universe: string;
  primary: SerializedTest;
  secondary: SerializedTest;
  verdict: { verdict: VerdictKind; criteria: Criterion[]; fragile: string[] } | null;
}

export interface DiscoveryRun {
  methodology: typeof METHODOLOGY;
  harness: { commit: string | null; dirty: boolean | null; rulesFrozenAt: string };
  ranAt: string;
  durationMs: number;
  rerunReason: string | null;
  data: {
    lastDate: string;
    testDays: number;
    coins: number;
    delistedCoins: number;
    top300Coins: number;
    /** Coins with fees on DefiLlama whose fee series failed to load this run: they score as "no fees". */
    feeSeriesMissing: string[];
    coinDays: { withBar: number; tooYoung: number; illiquid: number; unscorable: number; eligible: number };
  };
  configs: DiscoveryConfig[];
  files: string[];
}

/** The commit the harness runs from, and whether the working tree has uncommitted changes. */
export function gitState(): { commit: string | null; dirty: boolean | null } {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

/** Drops each event's comparison outcomes (kept in memory for the downside comparison; summarized in the metrics). */
const serialize = (t: TestResult): SerializedTest => ({
  ...t,
  eventRows: t.eventRows.map((e) => {
    const { baseOutcomes, ...rest } = e;
    void baseOutcomes;
    return rest;
  }),
  runRows: t.runRows,
});

export async function runDiscoveryH0(opts: { rerunReason: string | null }, report: (p: JobProgress) => void): Promise<DiscoveryRun> {
  const started = Date.now();
  const git = gitState();
  if (git.dirty !== false) throw new Error("The working tree isn't clean (or git isn't available): H0 must run from a recorded commit.");

  // §3: all trading pairs plus every delisted pair; coins need 100 bars of history plus an entry day.
  const data = await loadReplay(0, MIN_AGE + 2, report);
  const { coins, btcDates, btc } = data;
  report({ stage: "Scoring every coin on every test day (frozen H0 score)", done: 0, total: 0 });

  const bullAt = btcBullAt(btc);
  const testDays: number[] = [];
  for (let b = 199; b < btcDates.length; b += STEP_DAYS) testDays.push(b);
  const stages = sectorStages(data, testDays);

  const counts = { withBar: 0, tooYoung: 0, illiquid: 0, unscorable: 0, eligible: 0 };
  const days: TestDay[] = testDays.map((b) => {
    const d = btcDates[b];
    const dayCoins: TestDay["coins"] = [];
    coins.forEach((c, k) => {
      const i = c.pos.get(d);
      if (i === undefined) return;
      counts.withBar++;
      if (i < MIN_AGE) return void counts.tooYoung++;
      if ((c.vol30[i] ?? 0) < MIN_LIQUIDITY) return void counts.illiquid++;
      const inputs = coinDayInputs(c, d, i, coinNarrative(c, stages, b));
      const score = scoreFundamentals(inputs, { evidenceBase: REPLAYED }).score;
      if (score === null) return void counts.unscorable++;
      counts.eligible++;
      dayCoins.push({ coin: k, score, hasFees: inputs.hasFees });
    });
    return { date: d, bull: bullAt(b), coins: dayCoins };
  });

  const panel: Panel = {
    days,
    prices: coins.map((c) => ({ symbol: c.pair.base, dates: [...c.pos.keys()], closes: c.closes, delisted: c.pair.status === "BREAK" })),
    lastDate: btcDates[btcDates.length - 1],
  };
  const top = new Set(data.tradingByVolume.slice(0, TOP_N));
  const inTop = (k: number) => coins[k].pair.status === "BREAK" || top.has(coins[k].pair.base);
  const rule = (t: number): Rule => ({ label: `Fundamental score ≥ ${t}`, flag: (c) => c.score >= t });

  const configs: DiscoveryConfig[] = [];
  const plans = [
    { key: "h0", label: `H0: score ≥ ${H0_THRESHOLD}, all Binance pairs`, decisive: true, t: H0_THRESHOLD, include: undefined, universe: "All Binance pairs (trading + delisted)" },
    { key: "h0-65", label: `Information: score ≥ ${SENSITIVITY_THRESHOLD}, all Binance pairs`, decisive: false, t: SENSITIVITY_THRESHOLD, include: undefined, universe: "All Binance pairs (trading + delisted)" },
    { key: "h0-top300", label: `Information: score ≥ ${H0_THRESHOLD}, top ${TOP_N} by today's volume + delisted`, decisive: false, t: H0_THRESHOLD, include: inTop, universe: `Top ${TOP_N} by today's volume + delisted (carries today's-volume selection bias)` },
  ];
  for (const [n, p] of plans.entries()) {
    report({ stage: `Evaluating ${p.label}`, done: n, total: plans.length });
    const primary = runTest(panel, PRIMARY, rule(p.t), p.include);
    const secondary = runTest(panel, SECONDARY, rule(p.t), p.include);
    configs.push({
      key: p.key,
      label: p.label,
      decisive: p.decisive,
      rule: rule(p.t).label,
      universe: p.universe,
      primary: serialize(primary),
      secondary: serialize(secondary),
      verdict: p.decisive ? discoveryVerdict(primary, secondary) : null,
    });
  }

  const ranAt = new Date().toISOString();
  const run: DiscoveryRun = {
    methodology: METHODOLOGY,
    harness: { ...git, rulesFrozenAt: RULES_FROZEN_AT },
    ranAt,
    durationMs: Date.now() - started,
    rerunReason: opts.rerunReason,
    data: {
      lastDate: panel.lastDate,
      testDays: days.length,
      coins: coins.length,
      delistedCoins: coins.filter((c) => c.pair.status === "BREAK").length,
      top300Coins: coins.filter((_, k) => inTop(k)).length,
      feeSeriesMissing: data.feeSeriesMissing,
      coinDays: counts,
    },
    configs,
    files: [],
  };

  // The full output (every event and run) as JSON, plus a readable summary, both kept with the repository's results.
  try {
    const dir = path.join(process.cwd(), "results", "discovery");
    await mkdir(dir, { recursive: true });
    const stem = `h0-${ranAt.slice(0, 16).replace(/[:T]/g, "-")}`;
    run.files = [`results/discovery/${stem}.json`, `results/discovery/${stem}.md`];
    await writeFile(path.join(dir, `${stem}.json`), JSON.stringify(run, null, 1));
    await writeFile(path.join(dir, `${stem}.md`), renderDiscoveryMarkdown(run));
  } catch {
    run.files = [];
  }
  await setKv(DISCOVERY_KEY, run);
  return run;
}

export const latestDiscoveryRun = async () => (await getKv<DiscoveryRun>(DISCOVERY_KEY))?.value ?? null;
