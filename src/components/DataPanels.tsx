// Detail tables for a profile: technicals, fundamentals, tokenomics, liquidity, derivatives.

import type { CoinProfile } from "@/lib/types";
import { fmtNum, fmtPct, fmtUsd, fmtX } from "@/lib/format";

type Row = [label: string, value: string, hint?: string];

function Panel({ title, rows, empty }: { title: string; rows: Row[] | null; empty?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <h4 className="mb-1.5 text-base font-bold text-fg">{title}</h4>
      {rows ? (
        <table className="tabular w-full text-sm">
          <tbody>
            {rows.map(([label, value, hint]) => (
              <tr key={label} className="border-t border-line first:border-0">
                <td className="py-1 text-muted" title={hint}>
                  {label}
                </td>
                <td className="py-1 text-right text-fg">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-subtle">{empty}</p>
      )}
    </div>
  );
}

const funding = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(4)}% / 8h`);

export function DataPanels({ p }: { p: CoinProfile }) {
  const t = p.technicals;
  const f = p.fundamentals;
  const liq = p.liquidity;
  const d = p.derivatives;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <Panel
        title="Technicals"
        rows={[
          ["RSI (14)", t.rsi14 === null ? "—" : t.rsi14.toFixed(0), "Above 70 overbought, below 30 oversold"],
          ["MACD", t.macdHist === null ? "—" : `${t.macdHist > 0 ? "Bullish" : "Bearish"}${t.macdRising ? ", rising" : ", falling"}`],
          ["Price vs 20 / 50 / 200d avg", `${fmtPct(p.now.vsSma20)} / ${fmtPct(p.now.vsSma50)} / ${fmtPct(t.vsSma200)}`],
          ["50d vs 200d avg", t.sma50vs200 === null ? "—" : `${fmtPct(t.sma50vs200)} ${t.sma50vs200 > 0 ? "(golden)" : "(death)"}`],
          ["Return 7d / 90d / 1y", `${fmtPct(t.return7d)} / ${fmtPct(t.return90d)} / ${fmtPct(t.return1y)}`],
          ["vs BTC 30d / 90d / 1y", `${fmtPct(t.relStrength30d)} / ${fmtPct(t.relStrength90d)} / ${fmtPct(t.relStrength1y)}`],
          ["From 52w high / low", `${fmtPct(t.fromHigh52w)} / ${fmtPct(t.fromLow52w)}`],
          ["Max drawdown (1y)", fmtPct(t.maxDrawdown1y)],
          ["Volatility 30d / 90d", `${fmtPct(p.volatility30d, { signed: false })} / ${fmtPct(t.volatility90d, { signed: false })}`],
        ]}
      />
      <Panel
        title={f ? `Fundamentals · ${f.name} (${f.kind})` : "Fundamentals"}
        rows={
          f && [
            ["TVL", `${fmtUsd(f.tvl)} (${fmtPct(f.tvlChange7d)} 7d)`],
            ["Market cap ÷ TVL", fmtX(f.mcapToTvl)],
            ["Fees 30d", `${fmtUsd(f.fees30d)} (${fmtPct(f.feesGrowth30d)} vs prior)`],
            ["Revenue 30d", fmtUsd(f.revenue30d)],
            ["Annualized fees / revenue", `${fmtUsd(f.feesAnnualized)} / ${fmtUsd(f.revenueAnnualized)}`],
            ["Price-to-fees (P/F)", fmtX(f.priceToFees), "Market cap ÷ annualized fees"],
            ["Price-to-sales (P/S)", fmtX(f.priceToSales), "Market cap ÷ annualized revenue"],
            ["Fees growth 90d", fmtPct(f.feesGrowth90d)],
            ["Revenue growth 90d", fmtPct(f.revenueGrowth90d)],
          ]
        }
        empty="No TVL or fee data on DefiLlama. Not a DeFi protocol or chain (or not tracked)."
      />
      <Panel
        title="Tokenomics & project"
        rows={[
          ["Circulating supply", fmtPct(p.tokenomics.circulatingRatio, { signed: false })],
          ["FDV ÷ market cap", fmtX(p.tokenomics.fdvToMcap), "How much bigger the valuation gets once all tokens exist"],
          ["Supply inflation (annualized)", fmtPct(p.tokenomics.inflationAnnual)],
          ["Market cap / FDV", `${fmtUsd(p.marketCap)} / ${fmtUsd(p.fdv)}`],
          ["From all-time high", fmtPct(p.athChange)],
          ["Age", p.ageDays ? `${(p.ageDays / 365).toFixed(1)} yrs` : "1+ yrs"],
          ["GitHub commits (4 wks)", fmtNum(p.dev?.commits4w)],
          ["Bullish community votes", fmtPct(p.sentimentUp, { signed: false })],
        ]}
      />
      <Panel
        title="Exchanges & liquidity"
        rows={
          liq && [
            ["Exchanges / markets", `${liq.exchanges} / ${liq.markets}`],
            ["Tier-1 listings", liq.tier1.length ? liq.tier1.join(", ") : "None"],
            ["Order-book depth ±2% (tier-1)", fmtUsd(liq.depthUsd)],
            ["Top tier-1 venue", liq.topVenue ? `${liq.topVenue} (${fmtPct(liq.topVenueShare, { signed: false })})` : "—"],
            ["Volume on tier-1 venues", fmtPct(liq.trustedShare, { signed: false }), "The rest trades on smaller venues, where volume can be inflated"],
            ["Turnover (7d avg)", fmtPct(p.now.turnover, { signed: false })],
          ]
        }
        empty="No exchange data."
      />
      <Panel
        title={d ? `Derivatives · ${d.venue} ${d.symbol}` : "Derivatives"}
        rows={
          d && [
            ["Funding rate", funding(d.fundingRate), "Positive = longs pay shorts (bullish crowding)"],
            ["Open interest", fmtUsd(d.openInterestUsd)],
            ["OI change 7d / 30d", `${fmtPct(d.oiChange7d)} / ${fmtPct(d.oiChange30d)}`],
          ]
        }
        empty="No perpetual futures market found on Binance or Bybit."
      />
    </div>
  );
}
