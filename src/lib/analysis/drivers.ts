// Rule-based explanations of what drove a coin's move, plus red flags.
// Each rule cites the numbers it used so the reasoning is checkable.

import type { CoinProfile, Driver, RedFlag } from "@/lib/types";
import { fmtDate, fmtPct, fmtUsd, fmtX } from "@/lib/format";
import { rankCategories } from "./categories";

export type ProfileCore = Omit<CoinProfile, "drivers" | "redFlags" | "scores">;

export function detectDrivers(p: ProfileCore): Driver[] {
  const out: Driver[] = [];
  const r = p.rally;
  const bm = p.benchmark;

  if (r) {
    if (r.volumeRatio !== null) {
      if (r.volumeRatio >= 1.8) {
        out.push({
          kind: "volume",
          title: "Volume-backed run",
          detail: `Average volume during the run was ${fmtX(r.volumeRatio)} its pre-rally level. That is real buying demand, not a drift on thin order books.`,
          strength: r.volumeRatio >= 3 ? "strong" : "moderate",
        });
      } else if (r.volumeRatio < 1.2) {
        out.push({
          kind: "volume",
          title: "Low-volume move",
          detail: `Volume barely rose during the run (${fmtX(r.volumeRatio)} its pre-rally level). Moves without volume reverse more easily.`,
          strength: "weak",
        });
      }
    }

    if (p.setup.volTrend !== null && p.setup.volTrend >= 1.5) {
      out.push({
        kind: "volume",
        title: "Volume rose before the breakout",
        detail: `Volume was already ${fmtX(p.setup.volTrend)} its prior-month average when price broke above its 20-day average on ${fmtDate(r.breakoutDate)}, a sign of accumulation.`,
        strength: p.setup.volTrend >= 2.5 ? "strong" : "moderate",
      });
    }

    if (r.benchmarkGain !== null) {
      const excess = r.gain - r.benchmarkGain;
      if (r.benchmarkGain > 0 && r.benchmarkGain >= r.gain * 0.5) {
        out.push({
          kind: "market",
          title: "Market-wide lift",
          detail: `${bm} rose ${fmtPct(r.benchmarkGain)} over the same window, so a large part of this move came from the whole market rising.`,
          strength: "moderate",
        });
      } else if (excess >= 0.3) {
        out.push({
          kind: "momentum",
          title: `Outperformed ${bm}`,
          detail: `${fmtPct(r.gain)} vs ${bm} ${fmtPct(r.benchmarkGain)} over ${r.days} days. Coin-specific demand drove the move.`,
          strength: excess >= 1 ? "strong" : "moderate",
        });
      }
    }

    if (p.setup.fromHigh !== null) {
      if (p.setup.fromHigh <= -0.6) {
        out.push({
          kind: "momentum",
          title: "Rebound from a deep discount",
          detail: `It was ${fmtPct(p.setup.fromHigh, { signed: false })} below its 180-day high when the move began. This was a mean-reversion bounce.`,
          strength: "moderate",
        });
      } else if (p.setup.fromHigh >= -0.15) {
        out.push({
          kind: "momentum",
          title: "Breakout near highs",
          detail: `It started within ${fmtPct(-p.setup.fromHigh, { signed: false })} of its 180-day high: trend continuation into price discovery, with few trapped sellers overhead.`,
          strength: "moderate",
        });
      }
    }

    if (p.setup.marketCap !== null && p.setup.marketCap < 300e6) {
      out.push({
        kind: "size",
        title: "Small-cap starting point",
        detail: `Market cap was ${fmtUsd(p.setup.marketCap)} at the breakout, small enough for new money to move it quickly.`,
        strength: p.setup.marketCap < 100e6 ? "strong" : "moderate",
      });
    }
  }

  const circ = p.supply.circulatingRatio;
  if (circ !== null && circ < 0.4) {
    out.push({
      kind: "supply",
      title: "Low float",
      detail: `Only ${fmtPct(circ, { signed: false })} of supply circulates. Thin supply amplifies demand, but future unlocks can add selling pressure.`,
      strength: "moderate",
    });
  }

  const n = p.narrative;
  if (n && (n.phase === "Emerging" || n.phase === "Running")) {
    out.push({
      kind: "narrative",
      title: n.phase === "Emerging" ? "Early narrative" : "Narrative running",
      detail: `${n.sector} is ${n.phase.toLowerCase()}${n.since ? ` since ${fmtDate(n.since)}` : ""}: its coins are ${fmtPct(n.rel7)} vs BTC this week and ${fmtPct(n.rel30)} over 30 days.`,
      strength: n.strength >= 80 ? "strong" : "moderate",
    });
  }

  if (p.trendingCategories.length) {
    out.push({
      kind: "narrative",
      title: "Narrative tailwind",
      detail: `Belongs to ${p.trendingCategories.join(", ")}, which is trending right now.`,
      strength: "strong",
    });
  } else if (p.categories.length) {
    out.push({
      kind: "narrative",
      title: "Sector exposure",
      detail: `Tagged ${rankCategories(p.categories).slice(0, 3).join(", ")}. Check whether these sectors rallied together. If they did, the narrative was a driver.`,
      strength: "weak",
    });
  }

  const f = p.fundamentals;
  if (f) {
    if (f.tvlChange7d !== null && f.tvlChange7d >= 0.1) {
      out.push({
        kind: "fundamental",
        title: "TVL growing",
        detail: `${f.kind === "chain" ? "Chain" : "Protocol"} TVL rose ${fmtPct(f.tvlChange7d)} in 7 days to ${fmtUsd(f.tvl)}. Capital is flowing in, not just traders.`,
        strength: f.tvlChange7d >= 0.25 ? "strong" : "moderate",
      });
    }
    if (f.mcapToTvl !== null && f.mcapToTvl <= 1) {
      out.push({
        kind: "fundamental",
        title: "Cheap relative to TVL",
        detail: `Market cap is ${fmtX(f.mcapToTvl)} its TVL, low compared with most tokens.`,
        strength: "moderate",
      });
    }
    if (f.fees30d !== null && f.fees30d >= 1e6) {
      out.push({
        kind: "fundamental",
        title: "Real fee revenue",
        detail: `Generated ${fmtUsd(f.fees30d)} in fees over the last 30 days${f.priceToFees ? ` (price-to-fees ${fmtX(f.priceToFees)})` : ""}.`,
        strength: f.fees30d >= 10e6 ? "strong" : "moderate",
      });
    }
    if (f.feesGrowth30d !== null && f.feesGrowth30d >= 0.25) {
      out.push({
        kind: "fundamental",
        title: "Usage accelerating",
        detail: `Fees rose ${fmtPct(f.feesGrowth30d)} vs the previous 30 days. Growing demand often leads price.`,
        strength: f.feesGrowth30d >= 0.75 ? "strong" : "moderate",
      });
    }
  }

  const d = p.derivatives;
  if (d && d.oiChange30d !== null && d.oiChange30d >= 0.3) {
    out.push({
      kind: "market",
      title: "Leverage flowing in",
      detail: `Open interest on ${d.venue} futures rose ${fmtPct(d.oiChange30d)} in 30 days to ${fmtUsd(d.openInterestUsd)}. Traders are piling in with leverage.`,
      strength: "moderate",
    });
  }
  if (p.liquidity && p.liquidity.tier1.length >= 3) {
    out.push({
      kind: "catalyst",
      title: "Broad tier-1 access",
      detail: `Listed on ${p.liquidity.tier1.join(", ")}, so big pools of capital can buy it easily.`,
      strength: "weak",
    });
  }
  if (p.trendingCoin) {
    out.push({ kind: "narrative", title: "Trending coin", detail: "On CoinGecko's trending searches right now. Attention is high.", strength: "moderate" });
  }

  if (p.dev?.commits4w && p.dev.commits4w >= 50) {
    out.push({
      kind: "fundamental",
      title: "Active development",
      detail: `${p.dev.commits4w} GitHub commits in the last 4 weeks.`,
      strength: p.dev.commits4w >= 150 ? "moderate" : "weak",
    });
  }

  if (p.sentimentUp !== null && p.sentimentUp >= 0.8) {
    out.push({
      kind: "narrative",
      title: "Bullish community",
      detail: `${fmtPct(p.sentimentUp, { signed: false })} of CoinGecko sentiment votes are bullish.`,
      strength: "weak",
    });
  }

  if (r) {
    out.push({
      kind: "catalyst",
      title: "Check for catalysts",
      detail: `Listings, partnerships, upgrades and news don't show up in market data. Look at the project's announcements and X feed between ${fmtDate(r.lowDate)} and ${fmtDate(r.peakDate)}.`,
      strength: "weak",
    });
  } else {
    out.push({
      kind: "momentum",
      title: "No major rally in the last 90 days",
      detail: "The biggest low-to-high move was under 20%, so these readings describe current conditions rather than a completed run.",
      strength: "weak",
    });
  }

  const rank = { strong: 0, moderate: 1, weak: 2 };
  return out.sort((a, b) => rank[a.strength] - rank[b.strength]);
}

export function detectRedFlags(p: ProfileCore): RedFlag[] {
  const out: RedFlag[] = [];
  const circ = p.supply.circulatingRatio;

  if (p.narrative?.phase === "Overheated") {
    out.push({
      title: "Late-stage narrative",
      detail: `${p.narrative.sector} already ran hard against BTC and its momentum is fading. Late entries into hot narratives often buy the top.`,
      severity: "medium",
    });
  }

  if (p.marketCap === null) {
    out.push({ title: "No market cap data", detail: "Circulating supply isn't verified on CoinGecko.", severity: "medium" });
  } else if (p.marketCap < 10e6) {
    out.push({ title: "Micro-cap", detail: `Market cap of ${fmtUsd(p.marketCap)}. Prices are easy to manipulate and exits can be hard.`, severity: "high" });
  }
  if (circ !== null && circ < 0.3) {
    out.push({
      title: "Large unlock overhang",
      detail: `Only ${fmtPct(circ, { signed: false })} of supply circulates. Check the vesting/unlock schedule before buying.`,
      severity: "high",
    });
  }
  if (p.now.turnover !== null && p.now.turnover < 0.01) {
    out.push({ title: "Thin trading", detail: `Daily volume is only ${fmtPct(p.now.turnover, { signed: false })} of market cap.`, severity: "medium" });
  }
  if (p.change.d30 !== null && p.change.d30 > 1) {
    out.push({ title: "Already ran hard", detail: `Up ${fmtPct(p.change.d30)} in 30 days. Late entries often buy near the top.`, severity: "medium" });
  }
  if (p.rally && p.rally.fromPeakNow <= -0.4) {
    out.push({ title: "Faded from peak", detail: `Now ${fmtPct(p.rally.fromPeakNow)} below its recent peak. The move may be over.`, severity: "medium" });
  }
  if (p.now.vsSma20 !== null && p.now.vsSma50 !== null && p.now.vsSma20 < 0 && p.now.vsSma50 < 0) {
    out.push({ title: "Downtrend", detail: "Price is below both its 20-day and 50-day averages.", severity: "medium" });
  }
  if (p.volatility30d !== null && p.volatility30d > 1.5) {
    out.push({ title: "Extreme volatility", detail: `Annualized 30-day volatility of ${fmtPct(p.volatility30d, { signed: false })}.`, severity: "medium" });
  }
  if (p.historyDays < 60) {
    out.push({ title: "Short price history", detail: `Only ${p.historyDays} days of data. Patterns are unreliable.`, severity: "medium" });
  }
  if (p.technicals.rsi14 !== null && p.technicals.rsi14 >= 80) {
    out.push({ title: "Overbought", detail: `RSI is ${p.technicals.rsi14.toFixed(0)}. Short-term pullbacks are common from here.`, severity: "medium" });
  }
  const funding = p.derivatives?.fundingRate;
  if (funding !== null && funding !== undefined && Math.abs(funding) >= 0.0005) {
    out.push({
      title: funding > 0 ? "Crowded longs" : "Crowded shorts",
      detail: `Funding is ${(funding * 100).toFixed(3)}% per 8h on ${p.derivatives?.venue}, extreme enough to precede a liquidation cascade.`,
      severity: "medium",
    });
  }
  if (p.tokenomics.inflationAnnual !== null && p.tokenomics.inflationAnnual >= 0.3) {
    out.push({ title: "High supply inflation", detail: `Circulating supply is growing about ${fmtPct(p.tokenomics.inflationAnnual)} a year.`, severity: "medium" });
  }
  if (p.liquidity) {
    if (!p.liquidity.tier1.length) {
      out.push({ title: "No tier-1 exchange", detail: "Not listed on Binance, Coinbase, OKX, Kraken or similar.", severity: "medium" });
    }
    if (p.liquidity.topVenueShare !== null && p.liquidity.topVenueShare >= 0.7) {
      out.push({ title: "Volume on one venue", detail: `${fmtPct(p.liquidity.topVenueShare, { signed: false })} of volume trades on ${p.liquidity.topVenue}.`, severity: "low" });
    }
  }
  const u = p.unlocks;
  if (u && u.next90 >= 0.05) {
    const who = u.insiderShare !== null && u.insiderShare >= 0.5 ? ", mostly to team and investors" : "";
    const first = u.events[0];
    out.push({
      title: "Big unlock coming",
      detail: `${fmtPct(u.next90, { signed: false })} of circulating supply${u.value90Usd ? ` (about ${fmtUsd(u.value90Usd)})` : ""} unlocks in the next 90 days${who}${first ? `; next on ${first.date}` : ""}. Data: AlphaGrowth.`,
      severity: u.next90 >= 0.1 || (u.insiderShare ?? 0) >= 0.5 ? "high" : "medium",
    });
  }
  const h = p.holders;
  if (h) {
    // Plain wallets only when labels allow it: exchanges hold their users' coins, and contracts are often staking, bridges or vesting.
    const share = h.top10Wallets ?? h.top10;
    const limit = h.top10Wallets !== null ? 0.4 : 0.8;
    if (share >= limit) {
      out.push({
        title: "Concentrated holders",
        detail:
          h.top10Wallets !== null
            ? `The 10 biggest holders on ${h.chain} that are plain wallets own ${fmtPct(share, { signed: false })} of its supply there. A few sellers could move the price.`
            : `The 10 biggest holders on ${h.chain} own ${fmtPct(share, { signed: false })} of its supply there (who they are isn't labeled: check for exchanges and vesting contracts).`,
        severity: h.top10Wallets !== null && share >= 0.6 ? "high" : "medium",
      });
    }
  }
  if (p.dev?.hasRepo && p.dev.commits4w === 0) {
    out.push({ title: "No recent commits", detail: "Its public GitHub had no commits in the last 4 weeks.", severity: "low" });
  }

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
