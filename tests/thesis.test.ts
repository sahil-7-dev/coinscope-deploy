import { describe, expect, it } from "vitest";
import { brokenFromHistory, checkAssumption, describeCheck, thesisStatus } from "@/lib/analysis/thesis";
import { verdictFor } from "@/lib/analysis/verdict";
import type { Assumption, CoinResearch } from "@/lib/types";
import { narrative, profileWith } from "./fixtures";

const research = (assumptions: Assumption[], reviewOn: string | null = null): CoinResearch => ({
  ratings: { useCase: null, moat: null, team: null, ambition: null, feasibility: null },
  notes: { problem: "", unique: "", tokenValue: "", competitors: "", bull: "", base: "", bear: "", catalysts: "", invalidation: "" },
  thesis: { stance: "bullish", summary: "Usage keeps growing", assumptions, reviewOn },
  evidence: {},
  updatedAt: null,
});

const growing: Assumption = { id: "a1", text: "Usage keeps growing", check: { metric: "feesGrowth90d", op: ">=", value: 0 } };
const doubling: Assumption = { id: "a2", text: "Fees double", check: { metric: "feesGrowth90d", op: ">=", value: 1 } };

describe("thesis checks", () => {
  it("says an assumption holds when the data meets its rule", () => {
    // The fixture's 90-day fee growth is +40%.
    const r = checkAssumption(growing, profileWith(), null);
    expect(r.status).toBe("holds");
    expect(r.current).toBe("+40.0%");
  });

  it("says it's broken when the data misses its rule", () => {
    expect(checkAssumption(doubling, profileWith(), null).status).toBe("broken");
  });

  it("reports missing data instead of guessing", () => {
    expect(checkAssumption(growing, profileWith({ fundamentals: null }), null).status).toBe("no data");
  });

  it("checks the narrative stage against a list of stages", () => {
    const early: Assumption = { id: "a3", text: "Narrative stays early", check: { metric: "narrativeStage", op: "in", value: null, stages: ["Emerging", "Accelerating"] } };
    expect(checkAssumption(early, profileWith({ narrative: narrative("Accelerating") }), null).status).toBe("holds");
    expect(checkAssumption(early, profileWith({ narrative: narrative("Fading") }), null).status).toBe("broken");
  });

  it("leaves assumptions without a data check unchecked", () => {
    expect(checkAssumption({ id: "a4", text: "Team ships v2", check: null }, profileWith(), null).status).toBe("unchecked");
  });

  it("describes rules in plain words, with percentages", () => {
    expect(describeCheck({ metric: "holderShare", op: ">=", value: 0.1 })).toBe("Share of fees to token holders ≥ +10.0%");
  });

  it("flags a review date that has arrived", () => {
    expect(thesisStatus(research([growing], "2000-01-01"), profileWith()).reviewDue).toBe(true);
    expect(thesisStatus(research([growing], "2999-01-01"), profileWith()).reviewDue).toBe(false);
  });

  it("finds broken assumptions from the history, newest check first", () => {
    const events = [
      { kind: "assumption-broken", ref: "a1" },
      { kind: "assumption-holds", ref: "a1" },
      { kind: "assumption-holds", ref: "a2" },
    ];
    expect(brokenFromHistory(research([growing, doubling]), events).map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("thesis in verdicts", () => {
  it("keeps a coin with a broken assumption from a strong verdict, and says why", () => {
    const v = verdictFor(profileWith(), { research: research([doubling]) });
    expect(v.kind).not.toBe("strong");
    expect(v.reasons.some((r) => r.text.startsWith("Your thesis:"))).toBe(true);
    expect(v.thesis?.broken).toHaveLength(1);
  });

  it("leaves the verdict alone when every assumption holds", () => {
    expect(verdictFor(profileWith(), { research: research([growing]) }).kind).toBe("strong");
  });
});
