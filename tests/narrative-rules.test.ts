import { describe, expect, it } from "vitest";
import {
  classify,
  countBetween,
  feeGrowthAt,
  narrativeAttention,
  narrativeStage,
  smooth,
  summarizeFees,
  type NarrativeFundamentals,
} from "@/lib/analysis/narrative-rules";
import type { NarrativeReading } from "@/lib/types";

const fees = (g30: number | null, g90: number | null): NarrativeFundamentals => ({ feeGrowth30d: g30, feeGrowth90d: g90, withFees: 5, growing: 3 });
const flat = { g30: 0, g90: 0 };
const reading = (o: Partial<NarrativeReading>): NarrativeReading => ({ rel7: 0, rel30: 0, rel90: 0, volTrend: 1, breadth7: 0.5, breadth30: 0.5, ...o });

describe("narrative stage (fundamentals only)", () => {
  it("is Accelerating when fees beat the market on 30 and 90 days", () => {
    expect(narrativeStage(fees(0.3, 0.4), flat, null, null)).toBe("Accelerating");
  });

  it("is Emerging when only the last 30 days beat the market", () => {
    expect(narrativeStage(fees(0.3, 0.05), flat, null, null)).toBe("Emerging");
  });

  it("is Maturing after a strong quarter whose last month slowed", () => {
    expect(narrativeStage(fees(-0.05, 0.4), flat, null, null)).toBe("Maturing");
  });

  it("is Fading when fees shrink against the market", () => {
    expect(narrativeStage(fees(-0.1, -0.3), flat, null, null)).toBe("Fading");
  });

  it("measures fees against the market, so a market-wide rise is not growth", () => {
    expect(narrativeStage(fees(0.35, 0.45), { g30: 0.3, g90: 0.4 }, null, null)).toBe("Quiet");
  });

  it("calls builders arriving Emerging only when they beat DefiLlama's own listing pace", () => {
    const builders = { last90: 40, prev90: 10 };
    expect(narrativeStage(fees(null, null), flat, builders, { last90: 100, prev90: 100 })).toBe("Emerging");
    expect(narrativeStage(fees(null, null), flat, builders, { last90: 400, prev90: 100 })).toBe("Quiet");
  });

  it("ignores builder counts too small to mean anything", () => {
    expect(narrativeStage(fees(null, null), flat, { last90: 4, prev90: 0 }, null)).toBe("Quiet");
  });
});

describe("attention (price context, never scored)", () => {
  it("is Crowded after a big run", () => {
    expect(narrativeAttention("Running", reading({ rel30: 0.4 }))).toBe("Crowded");
    expect(narrativeAttention("Overheated", reading({}))).toBe("Crowded");
  });

  it("is Noticed when ahead of BTC or trending", () => {
    expect(narrativeAttention("Out of favor", reading({ rel30: 0.1 }))).toBe("Noticed");
    expect(narrativeAttention("Out of favor", reading({}), true)).toBe("Noticed");
  });

  it("is Unnoticed otherwise", () => {
    expect(narrativeAttention("Out of favor", reading({ rel30: -0.05 }))).toBe("Unnoticed");
  });
});

describe("market phase", () => {
  it("classifies a fresh turn as Emerging and a slip after a run as Cooling", () => {
    expect(classify(reading({ rel7: 0.05, rel30: 0.02 }))).toBe("Emerging");
    expect(classify(reading({ rel7: -0.05, rel30: 0.15 }))).toBe("Cooling");
  });
});

describe("helpers", () => {
  it("only switches a label after it holds for the required days", () => {
    expect(smooth(["A", "A", "B", "A", "B", "B", "B"], 3)).toEqual(["A", "A", "A", "A", "A", "A", "B"]);
  });

  it("computes 30- and 90-day fee growth", () => {
    const values = [...Array(150).fill(1), ...Array(30).fill(2)];
    const g = feeGrowthAt(values, values.length - 1);
    expect(g.g30).toBeCloseTo(1);
    expect(g.g90).toBeCloseTo(120 / 90 - 1);
  });

  it("returns null growth when history is too short", () => {
    expect(feeGrowthAt([1, 2, 3], 2)).toEqual({ g30: null, g90: null });
  });

  it("counts launches in a time window", () => {
    expect(countBetween([1, 2, 3, 4, 5], 2, 4)).toBe(2);
    expect(countBetween([], 0, 10)).toBe(0);
  });

  it("needs at least two fee-earning coins for a narrative's medians", () => {
    expect(summarizeFees([{ g30: 0.5, g90: 0.5 }]).feeGrowth90d).toBeNull();
    expect(summarizeFees([{ g30: 0.2, g90: 0.4 }, { g30: 0.4, g90: 0.6 }]).feeGrowth90d).toBeCloseTo(0.5);
  });
});
