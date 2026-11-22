import { describe, expect, it } from "vitest";
import { checkStages, crossMedian, forwardVsBtc, stageCalls, stageFinding, type StageTrack } from "@/lib/analysis/stage-check";
import { feeGrowthAt, feeGrowthLookup } from "@/lib/analysis/narrative-rules";
import type { NarrativeStage } from "@/lib/types";

const dates = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2023, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));

/** A track whose index grows by `daily` a day against a flat BTC. */
function track(id: string, stages: (NarrativeStage | null)[], daily = 0): StageTrack {
  const n = stages.length;
  return {
    id,
    name: id,
    dates: dates(n),
    stages,
    level: Array.from({ length: n }, (_, i) => (1 + daily) ** i),
    btc: Array(n).fill(1),
    members: Array(n).fill(5),
  };
}
const run = (stage: NarrativeStage, days: number) => Array<NarrativeStage>(days).fill(stage);

describe("stage check", () => {
  it("measures the index against BTC over the next days, and needs enough members and future", () => {
    const tr = track("a", run("Quiet", 200), 0.01);
    expect(forwardVsBtc(tr, 0, 90)).toBeCloseTo(1.01 ** 90 - 1);
    expect(forwardVsBtc(tr, 150, 90)).toBeNull();
    expect(forwardVsBtc({ ...tr, members: Array(200).fill(2) }, 0, 90)).toBeNull();
  });

  it("dates a stage change on the day it's confirmed and records how long it lasted", () => {
    const tr = track("a", [...run("Quiet", 30), ...run("Emerging", 40), ...run("Quiet", 30)]);
    const calls = stageCalls(tr, 5, {});
    expect(calls.map((c) => [c.from, c.to])).toEqual([
      ["Quiet", "Emerging"],
      ["Emerging", "Quiet"],
    ]);
    expect(calls[0].date).toBe(tr.dates[34]);
    expect(calls[0].days).toBe(40);
    expect(calls[0].ongoing).toBe(false);
    expect(calls[1].ongoing).toBe(true);
  });

  it("ignores a blip shorter than the confirmation length", () => {
    const tr = track("a", [...run("Quiet", 30), ...run("Fading", 3), ...run("Quiet", 30)]);
    expect(stageCalls(tr, 5, {})).toEqual([]);
    expect(stageCalls(tr, 1, {})).toHaveLength(2);
  });

  it("compares with the median narrative over the same days", () => {
    const tracks = [track("a", run("Quiet", 120), 0.01), track("b", run("Quiet", 120), 0), track("c", run("Quiet", 120), -0.01)];
    expect(crossMedian(tracks, 90)[0]).toBeCloseTo(0);
  });

  it("counts a new stage that changed again within a month as reversed", () => {
    const flip = [...run("Quiet", 40), ...run("Emerging", 10), ...run("Quiet", 200)];
    const r = checkStages([track("a", flip)], 5);
    const emerging = r.stages.find((s) => s.stage === "Emerging");
    expect(emerging?.calls).toBe(1);
    expect(emerging?.reversed).toBe(1);
    // The Quiet that followed is still running after 200 days: judged, and not reversed.
    expect(r.stages.find((s) => s.stage === "Quiet")?.reversed).toBe(0);
  });

  it("finds no signal when early stages don't beat the typical narrative in both periods", () => {
    const v = {
      confirmDays: 20,
      periods: [],
      variants: [{ days: 20, calls: 10, changesPerYear: 2.7, medianDays: 60, reversed: 0.12, earlyCalls: 5, earlyVsOthers90: 0.01, earlyBeatOthers90: 0.5, earlyBefore: 0.03, earlyFrom: -0.01 }],
    };
    expect(stageFinding(v).tone).toBe("warn");
    expect(stageFinding({ ...v, variants: [{ ...v.variants[0], earlyFrom: 0.025 }] }).tone).toBe("good");
  });
});

describe("fee growth lookup", () => {
  it("gives the same numbers as feeGrowthAt, with the day before as the last day counted", () => {
    const values = Array.from({ length: 300 }, (_, i) => 100 + i + (i % 7) * 5);
    const d = dates(300);
    const growth = feeGrowthLookup({ dates: d, values });
    expect(growth(d[250])).toEqual(feeGrowthAt(values, 249));
    expect(growth(d[0])).toEqual({ g30: null, g90: null });
  });
});
