import { describe, expect, it } from "vitest";
import { curve, logCurve } from "@/lib/analysis/curves";
import { combineCategories, scoreFundamentals, UNKNOWN_SCORE, usageVsPrice, type CategoryResult } from "@/lib/analysis/fundamentals";
import { faInputsWith } from "./fixtures";

const cat = (key: CategoryResult["key"], weight: number, score: number | null, evidence: CategoryResult["evidence"] = "data"): CategoryResult => ({ key, weight, score, evidence });

describe("scoring curves", () => {
  it("interpolates between points and stays flat beyond the ends", () => {
    const c: [number, number][] = [
      [0, 0],
      [10, 100],
    ];
    expect(curve(c, 5)).toBe(50);
    expect(curve(c, -5)).toBe(0);
    expect(curve(c, 50)).toBe(100);
  });

  it("compares dollar amounts on a log scale", () => {
    expect(logCurve([[1e6, 0], [1e8, 100]], 1e7)).toBeCloseTo(50);
  });
});

describe("combining categories", () => {
  it("averages scored categories by weight", () => {
    const r = combineCategories([cat("adoption", 10, 80), cat("valuation", 10, 60)]);
    expect(r.rawScore).toBe(70);
    expect(r.score).toBe(70);
  });

  it("pulls a good score toward unknown when evidence is thin", () => {
    // Half the weight has evidence: 0.5 × 80 + 0.5 × 45 = 62.5.
    const r = combineCategories([cat("adoption", 10, 80), cat("useCase", 10, null, "none")]);
    expect(r.confidence).toBe(0.5);
    expect(r.score).toBe(Math.round(0.5 * 80 + 0.5 * UNKNOWN_SCORE));
  });

  it("never raises a weak score because data is missing", () => {
    const r = combineCategories([cat("adoption", 10, 20), cat("useCase", 10, null, "none")]);
    expect(r.score).toBe(20);
  });

  it("gives no score when less than 40% of the weight is scored", () => {
    const r = combineCategories([cat("adoption", 10, 90), cat("useCase", 90, null, "none")]);
    expect(r.score).toBeNull();
  });

  it("counts confidence only over the evidence base when one is given", () => {
    const r = combineCategories([cat("adoption", 10, 80), cat("useCase", 10, null, "none")], ["adoption"]);
    expect(r.confidence).toBe(1);
    expect(r.score).toBe(80);
  });

  it("ignores categories whose weight is zero", () => {
    const r = combineCategories([cat("adoption", 10, 80), cat("valuation", 0, 0)]);
    expect(r.rawScore).toBe(80);
  });
});

describe("fundamental scorecard", () => {
  it("scores a coin without fees low on usage, value capture and valuation, as fallback (not evidence)", () => {
    const fa = scoreFundamentals(faInputsWith({ hasFees: false }));
    for (const key of ["adoption", "valueCapture", "valuation"] as const) {
      const c = fa.categories.find((x) => x.key === key);
      expect(c?.evidence).toBe("fallback");
      expect(c?.score).toBeLessThanOrEqual(25);
    }
  });

  it("treats fees with no holder payouts as holders getting nothing", () => {
    const fa = scoreFundamentals(faInputsWith({ hasFees: true, feesAnnualized: 1e7, holderShare: null }));
    const metric = fa.categories.find((c) => c.key === "valueCapture")?.metrics.find((m) => m.label.startsWith("Share of fees to token holders"));
    expect(metric?.display).toBe("0.0%");
    expect(metric?.score).toBe(15);
  });

  it("rates fee growth up to doubling, but tapers extreme spikes", () => {
    const growthScore = (g: number) =>
      scoreFundamentals(faInputsWith({ hasFees: true, feesGrowth90d: g })).categories.find((c) => c.key === "adoption")?.metrics.find((m) => m.label.startsWith("Fee growth (90d"))?.score;
    expect(growthScore(1) as number).toBeGreaterThan(growthScore(0.3) as number);
    expect(growthScore(3) as number).toBeLessThan(growthScore(1) as number);
  });

  it("uses your ratings for use case, and marks them as yours", () => {
    const fa = scoreFundamentals(faInputsWith({ ratings: { useCase: 8, moat: null, team: null, ambition: null, feasibility: null } }));
    const useCase = fa.categories.find((c) => c.key === "useCase");
    expect(useCase?.score).toBe(80);
    expect(useCase?.evidence).toBe("you");
  });

  it("measures usage against price", () => {
    expect(usageVsPrice(1, 0)).toBe(1);
    expect(usageVsPrice(0, 1)).toBe(-0.5);
    expect(usageVsPrice(null, 0.2)).toBeNull();
  });
});
