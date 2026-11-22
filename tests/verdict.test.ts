import { describe, expect, it } from "vitest";
import { verdictFor } from "@/lib/analysis/verdict";
import { narrative, profileWith } from "./fixtures";

describe("verdicts", () => {
  it("calls strong fundamentals in an accelerating, unnoticed narrative a strong candidate", () => {
    const v = verdictFor(profileWith());
    expect(v.kind).toBe("strong");
    expect(v.fundamentals.score).toBeGreaterThanOrEqual(65);
  });

  it("keeps a crowded narrative from a strong verdict, and says it's market context", () => {
    const v = verdictFor(profileWith({ narrative: narrative("Accelerating", "Crowded") }));
    expect(v.kind).toBe("watch");
    expect(v.reasons.some((r) => r.text.startsWith("Market context"))).toBe(true);
    expect(v.changeIf.some((c) => c.includes("market context"))).toBe(true);
  });

  it("doesn't let attention change the fundamental score", () => {
    const calm = verdictFor(profileWith({ narrative: narrative("Accelerating", "Unnoticed") }));
    const crowded = verdictFor(profileWith({ narrative: narrative("Accelerating", "Crowded") }));
    expect(crowded.fundamentals.score).toBe(calm.fundamentals.score);
  });

  it("avoids coins with a high-severity red flag", () => {
    const v = verdictFor(profileWith({ redFlags: [{ title: "Micro-cap", detail: "", severity: "high" }] }));
    expect(v.kind).toBe("avoid");
  });

  it("avoids extreme risk", () => {
    expect(verdictFor(profileWith({ risk: 85 })).kind).toBe("avoid");
  });

  it("avoids coins with no measurable usage and no early narrative", () => {
    expect(verdictFor(profileWith({ fundamentals: null, narrative: narrative("Quiet") })).kind).toBe("avoid");
  });

  it("calls a good narrative without measurable usage speculative", () => {
    expect(verdictFor(profileWith({ fundamentals: null, narrative: narrative("Accelerating") })).kind).toBe("speculative");
  });

  it("keeps a coin unlike its benchmark from a strong verdict", () => {
    const v = verdictFor(profileWith(), { match: { score: 30, reference: "ZEC before its run" } });
    expect(v.kind).toBe("watch");
    expect(v.changeIf.some((c) => c.includes("benchmark"))).toBe(true);
  });

  it("warns that 70+ scores were often peaks", () => {
    const v = verdictFor(profileWith());
    if ((v.fundamentals.score ?? 0) >= 70) expect(v.reasons.some((r) => r.text.includes("70+"))).toBe(true);
  });
});
