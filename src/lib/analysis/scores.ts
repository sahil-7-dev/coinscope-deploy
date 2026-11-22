// Short-, mid- and long-term investment scores plus a risk score. Each is a
// weighted blend of factors; each factor maps one metric onto 0–100 with a
// piecewise-linear curve, so every number in the UI traces back to a rule.

import type { HorizonScore, InvestmentScores, ScoreFactor, Tone } from "@/lib/types";
import { fmtNum, fmtPct, fmtUsd, fmtX } from "@/lib/format";
import type { ProfileCore } from "./drivers";

import { curve, logCurve, type Curve } from "./curves";
import { faInputs, scoreFundamentals } from "./fundamentals";

function factor(
  name: string,
  value: number | null | undefined,
  fmt: (v: number) => string,
  score: (v: number) => number,
  weight: number,
  note: string,
): ScoreFactor {
  const known = value !== null && value !== undefined && Number.isFinite(value);
  return {
    name,
    display: known ? fmt(value) : "—",
    score: known ? Math.round(score(value)) : null,
    weight,
    note,
  };
}

const MIN_COVERAGE = 0.4;

function compose(factors: ScoreFactor[], kind: "opportunity" | "risk"): HorizonScore {
  const total = factors.reduce((s, f) => s + f.weight, 0);
  const known = factors.filter((f) => f.score !== null);
  const knownWeight = known.reduce((s, f) => s + f.weight, 0);
  const coverage = total ? knownWeight / total : 0;
  if (coverage < MIN_COVERAGE) return { score: null, coverage, label: "Not enough data", tone: "neutral", factors };

  const score = Math.round(known.reduce((s, f) => s + (f.score as number) * f.weight, 0) / knownWeight);
  let label: string;
  let tone: Tone;
  if (kind === "risk") {
    [label, tone] = score >= 70 ? ["Very high", "bad"] : score >= 50 ? ["High", "warn"] : score >= 30 ? ["Moderate", "neutral"] : ["Low", "good"];
  } else {
    [label, tone] = score >= 70 ? ["Strong", "good"] : score >= 55 ? ["Favorable", "good"] : score >= 40 ? ["Neutral", "neutral"] : ["Weak", "bad"];
  }
  return { score, coverage, label, tone, factors };
}

const pct = (v: number) => fmtPct(v);
const pctAbs = (v: number) => fmtPct(v, { signed: false });
const fundingFmt = (v: number) => `${(v * 100).toFixed(4)}% / 8h`;
const INFLATION: Curve = [
  [0, 100],
  [0.05, 85],
  [0.15, 55],
  [0.3, 25],
  [0.6, 0],
];

function shortTerm(p: ProfileCore): HorizonScore {
  const t = p.technicals;
  const macd = t.macdHist === null ? null : t.macdHist > 0 ? (t.macdRising ? 100 : 70) : t.macdRising ? 45 : 15;
  const attention = p.trendingCoin ? 100 : p.trendingCategories.length ? 75 : 40;
  return compose(
    [
      factor("Momentum vs BTC (14d)", p.now.relStrength14d, pct, (v) => curve([[-0.2, 0], [0, 50], [0.2, 100]], v), 20, "Coin's 14-day return minus BTC's. Leaders tend to keep leading short term."),
      factor("Price vs 20-day average", p.now.vsSma20, pct, (v) => curve([[-0.1, 10], [0, 50], [0.08, 90], [0.25, 70], [0.5, 30]], v), 15, "Above the 20-day average = short-term uptrend. Far above = overextended."),
      factor("RSI (14)", t.rsi14, (v) => v.toFixed(0), (v) => curve([[20, 45], [30, 40], [45, 55], [55, 80], [65, 100], [72, 80], [80, 35], [90, 15]], v), 15, "55–70 is healthy momentum; above 75–80 is overbought."),
      factor("MACD", macd, (v) => (v >= 70 ? "Bullish" : "Bearish") + (t.macdRising ? ", rising" : ", falling"), (v) => v, 10, "Histogram above zero and rising = momentum building."),
      factor("Volume trend (7d vs prior 30d)", p.now.volTrend, fmtX, (v) => curve([[0.5, 10], [1, 45], [1.5, 75], [2.5, 100]], v), 15, "Rising volume confirms moves."),
      factor("Liquidity (turnover)", p.now.turnover, pctAbs, (v) => curve([[0.005, 10], [0.02, 50], [0.05, 80], [0.15, 100]], v), 10, "Daily volume ÷ market cap. Easy in, easy out."),
      factor("Funding rate", p.derivatives?.fundingRate, fundingFmt, (v) => curve([[-0.0005, 70], [-0.0001, 85], [0, 80], [0.0001, 70], [0.0003, 45], [0.0008, 15]], v), 10, "High positive funding = crowded longs that can get flushed."),
      factor("Attention", attention, (v) => (v === 100 ? "Trending coin" : v === 75 ? "Trending sector" : "Not trending"), (v) => v, 5, "On CoinGecko's trending list, or in a trending sector."),
    ],
    "opportunity",
  );
}

/**
 * Mid-term slot = the fundamental scorecard from data alone (your research
 * ratings are added on the coin page). Each category shows up as one factor.
 */
function fundamentalsScore(p: ProfileCore): HorizonScore {
  const fa = scoreFundamentals(faInputs(p));
  const EVIDENCE = { data: "From data", you: "Your rating", "data + you": "Data + your rating", fallback: "No data (counts against)", none: "Not rated / no data" };
  return {
    score: fa.score,
    coverage: fa.confidence,
    label: fa.label,
    tone: fa.tone,
    factors: fa.categories.map((c) => ({ name: c.label, display: EVIDENCE[c.evidence], score: c.score, weight: c.weight, note: c.why })),
  };
}

function longTerm(p: ProfileCore): HorizonScore {
  const f = p.fundamentals;
  const t = p.technicals;
  const liq = p.liquidity;
  const growth = f?.revenueGrowth90d ?? f?.feesGrowth90d;
  // No tracked fees means no measurable cash flow (memes, pure currencies): for a
  // long-term hold that's a real weakness, so it scores low instead of being skipped.
  const noCashFlow = f?.feesAnnualized == null;
  const none = (score: number, note: string) => (name: string, weight: number) => factor(name, 0, () => "None tracked", () => score, weight, note);
  return compose(
    [
      noCashFlow
        ? none(15, "No fee data on DefiLlama, so no measurable cash flow (common for memes and pure currencies).")("Annualized fees", 20)
        : factor("Annualized fees", f.feesAnnualized, fmtUsd, (v) => logCurve([[1e5, 5], [1e6, 30], [1e7, 60], [1e8, 85], [1e9, 100]], v), 20, "Real demand for the network/protocol."),
      noCashFlow
        ? none(10, "Without fees there's nothing to anchor the valuation to.")("Price-to-fees (P/F)", 15)
        : factor("Price-to-fees (P/F)", f.priceToFees, fmtX, (v) => logCurve([[3, 100], [10, 90], [30, 70], [100, 40], [300, 15], [1000, 0]], v), 15, "Market cap ÷ annualized fees. Lower = cheaper for the usage you get."),
      noCashFlow
        ? none(20, "No revenue history to show growth.")("Revenue growth (90d vs prior 90d)", 10)
        : factor("Revenue growth (90d vs prior 90d)", growth, pct, (v) => curve([[-0.5, 5], [0, 45], [0.3, 80], [1, 100]], v), 10, "Long-run growth in protocol revenue (fees if revenue isn't tracked)."),
      factor("Circulating supply", p.tokenomics.circulatingRatio, pctAbs, (v) => curve([[0.15, 5], [0.4, 40], [0.7, 75], [0.95, 100]], v), 10, "How much of the eventual supply already trades. Less = more future dilution."),
      factor("Supply inflation", p.tokenomics.inflationAnnual, pct, (v) => curve(INFLATION, v), 10, "Ongoing dilution of holders."),
      factor("Developer activity (commits, 4 wks)", p.dev?.commits4w, fmtNum, (v) => curve([[0, 0], [10, 40], [50, 75], [150, 100]], v), 10, "Teams that keep shipping survive bear markets."),
      factor("Tier-1 exchange listings", liq ? liq.tier1.length : null, (v) => (liq?.tier1.length ? `${v}: ${liq.tier1.slice(0, 4).join(", ")}${liq.tier1.length > 4 ? "…" : ""}` : "None"), (v) => curve([[0, 5], [1, 45], [3, 80], [5, 100]], v), 10, "Listings on Binance, Coinbase, OKX, Kraken… mean scrutiny and access to capital."),
      factor("Order-book depth (±2%)", liq?.depthUsd, fmtUsd, (v) => logCurve([[1e4, 5], [1e5, 30], [1e6, 65], [1e7, 100]], v), 5, "Size you can trade without moving the price."),
      factor("Track record (age)", p.ageDays, (v) => `${(v / 365).toFixed(1)} yrs`, (v) => curve([[90, 5], [365, 35], [1095, 70], [2190, 100]], v), 5, "Survived more cycles."),
      factor("Market cap size", p.marketCap, fmtUsd, (v) => logCurve([[1e7, 5], [1e8, 30], [1e9, 60], [1e10, 85], [1e11, 100]], v), 5, "Established, harder to manipulate."),
      factor("1-year return vs BTC", t.relStrength1y, pct, (v) => curve([[-0.8, 5], [-0.3, 30], [0, 55], [1, 90]], v), 5, "Has it held value against BTC over a full year?"),
    ],
    "opportunity",
  );
}

function risk(p: ProfileCore): HorizonScore {
  const t = p.technicals;
  const liq = p.liquidity;
  const funding = p.derivatives?.fundingRate;
  return compose(
    [
      factor("Volatility (90d, annualized)", t.volatility90d, pctAbs, (v) => curve([[0.3, 5], [0.6, 30], [1, 60], [1.5, 85], [2.5, 100]], v), 20, "How violently the price swings."),
      factor("Max drawdown (1y)", t.maxDrawdown1y, pct, (v) => curve([[0.2, 5], [0.4, 30], [0.6, 55], [0.8, 80], [0.95, 100]], -v), 15, "Worst peak-to-trough fall in the last year."),
      factor("Thin trading (turnover)", p.now.turnover, pctAbs, (v) => curve([[0.005, 95], [0.01, 75], [0.03, 40], [0.1, 10]], v), 10, "Low volume vs market cap = hard to exit."),
      factor("Shallow order books (±2% depth)", liq?.depthUsd, fmtUsd, (v) => logCurve([[1e4, 95], [1e5, 70], [1e6, 35], [1e7, 10]], v), 5, "Small depth = big slippage and easy manipulation."),
      factor("Unlock overhang", p.tokenomics.circulatingRatio, pctAbs, (v) => curve([[0.15, 100], [0.3, 80], [0.5, 55], [0.8, 20], [0.95, 5]], v), 15, "Share of supply circulating. Low = big unlocks ahead."),
      factor("Supply inflation", p.tokenomics.inflationAnnual, pct, (v) => curve([[0, 5], [0.1, 40], [0.3, 75], [0.6, 100]], v), 10, "Fast supply growth pressures price."),
      factor("Small size", p.marketCap, fmtUsd, (v) => logCurve([[1e7, 100], [1e8, 75], [1e9, 45], [1e10, 20], [1e11, 5]], v), 10, "Smaller caps are easier to pump, dump and delist."),
      factor("Venue concentration", liq?.topVenueShare, pctAbs, (v) => curve([[0.3, 10], [0.5, 35], [0.7, 65], [0.9, 90]], v), 5, liq?.topVenue ? `Top venue: ${liq.topVenue}.` : "Share of volume on the largest exchange."),
      factor("Short track record", p.ageDays, (v) => `${(v / 365).toFixed(1)} yrs`, (v) => curve([[90, 95], [365, 65], [1095, 30], [2190, 10]], v), 5, "Newer tokens fail more often."),
      factor("Leverage heat (funding)", funding === null || funding === undefined ? null : Math.abs(funding), fundingFmt, (v) => curve([[0, 10], [0.0001, 20], [0.0003, 55], [0.0008, 90]], v), 5, "Extreme funding either way precedes liquidation cascades."),
    ],
    "risk",
  );
}

export function computeScores(p: ProfileCore): InvestmentScores {
  return { short: shortTerm(p), mid: fundamentalsScore(p), long: longTerm(p), risk: risk(p) };
}
