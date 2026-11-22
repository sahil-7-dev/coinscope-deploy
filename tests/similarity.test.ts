import { describe, expect, it } from "vitest";
import { biggestRun, findRuns } from "@/lib/analysis/series";
import { buildPattern, compareCoins, matchPattern, patternDifferences } from "@/lib/analysis/similarity";
import { seriesOf, snapshotWith } from "./fixtures";

describe("benchmark comparison", () => {
  it("rates a coin identical to its benchmark 100% similar", () => {
    const r = compareCoins(snapshotWith(), snapshotWith({ id: "cand", symbol: "CND" }));
    expect(r.overall).toBe(100);
    expect(r.stronger).toEqual([]);
    expect(r.weaker).toEqual([]);
  });

  it("knows a lower P/F is stronger and says by how much", () => {
    const r = compareCoins(snapshotWith(), snapshotWith({ id: "cand", priceToFees: 4 }));
    const pf = r.groups.flatMap((g) => g.features).find((f) => f.label === "Price-to-fees");
    expect(pf?.edge).toBe("stronger");
    expect(pf?.gap).toBe("3.0× smaller");
  });

  it("treats a coin with no fees as having none, not as unknown", () => {
    const r = compareCoins(snapshotWith(), snapshotWith({ id: "cand", hasFees: false, fees30d: null, priceToFees: null }));
    const fees = r.groups.flatMap((g) => g.features).find((f) => f.label === "Fees (30d)");
    expect(fees?.candidate).toBe("None");
    expect(fees?.edge).toBe("weaker");
  });

  it("lists metrics that couldn't be compared and which side lacks them", () => {
    const r = compareCoins(snapshotWith({ asOf: "2026-03-15", tvl: null }), snapshotWith({ id: "cand", symbol: "CND" }));
    expect(r.missing.some((m) => m.startsWith("TVL") && m.includes("REF before its run"))).toBe(true);
  });
});

describe("winner pattern", () => {
  const winners = [snapshotWith({ priceToFees: 10, feesGrowth90d: 0.3 }), snapshotWith({ id: "b", priceToFees: 20, feesGrowth90d: 0.5 })];

  it("builds ranges from what the winners shared", () => {
    const pf = buildPattern(winners).find((m) => m.key === "priceToFees");
    expect(pf).toMatchObject({ min: 10, max: 20, count: 2, tooWide: false });
  });

  it("marks ranges the winners disagree on wildly as too wide, and leaves them out of the match", () => {
    const pattern = buildPattern([snapshotWith({ priceToFees: 2 }), snapshotWith({ id: "b", priceToFees: 20_000 })]);
    expect(pattern.find((m) => m.key === "priceToFees")?.tooWide).toBe(true);
    const m = matchPattern(pattern, snapshotWith({ priceToFees: 5_000 }));
    expect(m.inside.concat(m.outside).some((x) => x.startsWith("Price-to-fees"))).toBe(false);
  });

  it("scores a candidate inside every range 100, and lists metrics outside", () => {
    const pattern = buildPattern(winners);
    expect(matchPattern(pattern, snapshotWith({ priceToFees: 15, feesGrowth90d: 0.4 })).score).toBe(100);
    const off = matchPattern(pattern, snapshotWith({ priceToFees: 500, feesGrowth90d: 0.4 }));
    expect(off.outside.some((x) => x.startsWith("Price-to-fees"))).toBe(true);
    expect(off.score as number).toBeLessThan(100);
  });
});

describe("finding a winner's run", () => {
  it("finds the biggest low-to-high run and a breakout after the low", () => {
    const prices = [...Array(40).fill(10), ...Array(20).fill(5), ...Array.from({ length: 30 }, (_, i) => 5 + i), ...Array(20).fill(20)];
    const run = biggestRun(seriesOf(prices), 365, 0.5);
    expect(run).not.toBeNull();
    expect(prices[run!.lowIndex]).toBe(5);
    expect(prices[run!.peakIndex]).toBe(34);
    expect(run!.breakoutIndex).toBeGreaterThan(run!.lowIndex);
    expect(run!.breakoutIndex).toBeLessThanOrEqual(run!.peakIndex);
  });

  it("finds nothing when no run is big enough", () => {
    expect(biggestRun(seriesOf(Array(100).fill(10)), 365, 0.5)).toBeNull();
  });
});

describe("finding every run", () => {
  const ramp = (from: number, to: number, days: number) => Array.from({ length: days }, (_, i) => from + ((to - from) * (i + 1)) / days);

  it("finds separate runs, each ended by a big fall from its peak", () => {
    const prices = [...Array(30).fill(10), ...ramp(10, 20, 20), ...ramp(20, 12, 10), ...Array(20).fill(12), ...ramp(12, 30, 20), ...ramp(30, 18, 10)];
    const runs = findRuns(seriesOf(prices), 0.5, 0.3);
    expect(runs).toHaveLength(2);
    expect(prices[runs[0].peakIndex]).toBe(20);
    expect(prices[runs[1].lowIndex]).toBe(12);
    expect(prices[runs[1].peakIndex]).toBe(30);
  });

  it("still records a run when the price crashes below its starting low in one day", () => {
    const prices = [...Array(30).fill(10), ...ramp(10, 20, 20), 5, ...Array(20).fill(5)];
    const runs = findRuns(seriesOf(prices), 0.5, 0.3);
    expect(runs).toHaveLength(1);
    expect(prices[runs[0].peakIndex]).toBe(20);
  });

  it("keeps a run that's still going at the end", () => {
    const prices = [...Array(30).fill(10), ...ramp(10, 25, 30)];
    const runs = findRuns(seriesOf(prices), 0.5, 0.3);
    expect(runs).toHaveLength(1);
    expect(runs[0].gain).toBeCloseTo(1.5);
  });

  it("ignores moves smaller than the minimum", () => {
    expect(findRuns(seriesOf([...Array(30).fill(10), ...ramp(10, 13, 20), ...ramp(13, 8, 10)]), 0.5, 0.3)).toHaveLength(0);
  });
});

describe("what winners did not share", () => {
  it("lists mixed fee earners, mixed narrative stages, wide metrics and one-off data", () => {
    const diffs = patternDifferences([
      snapshotWith({ symbol: "AAA", priceToFees: 2, narrativeStage: "Accelerating", tvl: 1e9 }),
      snapshotWith({ id: "b", symbol: "BBB", hasFees: false, fees30d: null, priceToFees: 20_000, narrativeStage: "Quiet", tvl: null }),
    ]);
    expect(diffs.some((d) => d.startsWith("Fees: only AAA earned fees"))).toBe(true);
    expect(diffs.some((d) => d.startsWith("Narrative stage:"))).toBe(true);
    expect(diffs.some((d) => d.startsWith("Price-to-fees:") && d.includes("too far apart"))).toBe(true);
    expect(diffs.some((d) => d === "TVL: only AAA had data.")).toBe(true);
  });

  it("has nothing to say about a single winner", () => {
    expect(patternDifferences([snapshotWith()])).toEqual([]);
  });
});
