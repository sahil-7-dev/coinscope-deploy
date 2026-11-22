import { describe, expect, it } from "vitest";
import { decisionResult, isLoggedLate, journalSummary } from "@/lib/analysis/journal";
import type { Decision } from "@/lib/types";

function decision(o: Partial<Decision> = {}): Decision {
  return {
    id: 1,
    coinId: "test",
    symbol: "TST",
    name: "Test",
    image: null,
    action: "buy",
    decidedOn: "2026-01-01",
    price: 10,
    btcPrice: 100,
    verdict: "strong",
    verdictLabel: "Strong candidate",
    score: 70,
    confidence: 0.6,
    sector: "Test",
    stage: "Emerging",
    attention: "Unnoticed",
    thesis: "",
    note: "",
    closedOn: null,
    closePrice: null,
    closeBtcPrice: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...o,
  };
}

describe("decision results", () => {
  it("judges a decision against BTC over the same days", () => {
    // Coin +50%, BTC +20% → 1.5 / 1.2 − 1 = +25% vs BTC.
    const r = decisionResult(decision(), { price: 15, btcPrice: 120 }, "2026-03-01");
    expect(r.return).toBeCloseTo(0.5);
    expect(r.btcReturn).toBeCloseTo(0.2);
    expect(r.vsBtc).toBeCloseTo(0.25);
    expect(r.days).toBe(59);
    expect(r.counted).toBe(true);
  });

  it("stops the clock at the sale", () => {
    const r = decisionResult(decision({ closedOn: "2026-02-15", closePrice: 8, closeBtcPrice: 100 }), { price: 30, btcPrice: 300 }, "2026-06-01");
    expect(r.return).toBeCloseTo(-0.2);
    expect(r.vsBtc).toBeCloseTo(-0.2);
    expect(r.days).toBe(45);
  });

  it("doesn't count decisions younger than 30 days, or without a current price", () => {
    expect(decisionResult(decision(), { price: 15, btcPrice: 120 }, "2026-01-20").counted).toBe(false);
    expect(decisionResult(decision(), { price: null, btcPrice: 120 }, "2026-03-01").counted).toBe(false);
  });

  it("flags decisions logged more than a day after they were made", () => {
    expect(isLoggedLate(decision({ decidedOn: "2025-12-01" }))).toBe(true);
    expect(isLoggedLate(decision({ decidedOn: "2025-12-31" }))).toBe(false);
  });
});

describe("journal summary", () => {
  const today = "2026-06-01";
  const results = [
    decisionResult(decision({ id: 1 }), { price: 20, btcPrice: 100 }, today), // buy, Strong: +100% vs BTC
    decisionResult(decision({ id: 2, verdict: "avoid", verdictLabel: "Avoid" }), { price: 5, btcPrice: 100 }, today), // buy against the app: −50%
    decisionResult(decision({ id: 3, action: "pass", verdict: "avoid", verdictLabel: "Avoid", stage: null }), { price: 8, btcPrice: 100 }, today), // good pass
    decisionResult(decision({ id: 4, decidedOn: "2026-05-25", createdAt: "2026-05-25T00:00:00Z" }), { price: 20, btcPrice: 100 }, today), // too new
    decisionResult(decision({ id: 5, decidedOn: "2025-12-01", verdict: "avoid" }), { price: 1, btcPrice: 100 }, today), // logged late
  ];
  const s = journalSummary(results);

  it("splits buys and passes, and waits on new decisions", () => {
    expect(s.buys.decisions).toBe(3);
    expect(s.passes.decisions).toBe(1);
    expect(s.passes.beatBtc).toBe(0);
    expect(s.tooEarly).toBe(1);
  });

  it("checks the app's verdicts only on decisions logged on the day", () => {
    const avoid = s.byVerdict.find((g) => g.label === "Avoid");
    expect(avoid?.decisions).toBe(2);
    expect(avoid?.vsBtc).toBeCloseTo(-0.35);
    expect(s.byVerdict.find((g) => g.label === "Strong candidate")?.vsBtc).toBeCloseTo(1);
  });

  it("singles out buys that went against the app", () => {
    expect(s.against.decisions).toBe(1);
    expect(s.against.vsBtc).toBeCloseTo(-0.5);
  });

  it("groups by narrative stage at the time", () => {
    expect(s.byStage.find((g) => g.label === "No tracked narrative")?.decisions).toBe(1);
  });
});
