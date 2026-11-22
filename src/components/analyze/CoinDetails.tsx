// Shared pieces for showing a CoinProfile: header, metrics table, drivers, red flags.

import type { CoinProfile, Driver, RedFlag, Snapshot, Strength, Tone } from "@/lib/types";
import { fmtDate, fmtNum, fmtPct, fmtPrice, fmtUsd, fmtX } from "@/lib/format";
import { rankCategories } from "@/lib/analysis/categories";
import { Badge, CoinIcon, Pct } from "@/components/ui";

export function CoinHeader({ p }: { p: CoinProfile }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <CoinIcon src={p.image} alt={p.name} size={28} />
      <div>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-fg">{p.name}</span>
          <span className="text-sm text-subtle">{p.symbol}</span>
          {p.rank && <span className="text-xs text-faint">#{p.rank}</span>}
        </div>
        <div className="tabular text-sm text-muted">
          {fmtPrice(p.price)} · 7d <Pct value={p.change.d7} /> · 30d <Pct value={p.change.d30} /> · 1y <Pct value={p.change.y1} />
        </div>
      </div>
      <div className="ml-auto flex flex-wrap justify-end gap-1">
        {rankCategories(p.categories)
          .slice(0, 4)
          .map((c) => (
          <Badge key={c} tone={p.trendingCategories.includes(c) ? "good" : "neutral"}>
            {c}
          </Badge>
        ))}
      </div>
    </div>
  );
}

/** CoinGecko-style hero for the coin page: big price, 24h move, and key market stats. */
export function CoinHero({ p }: { p: CoinProfile }) {
  const last7 = p.series.slice(-7).map((x) => x.price);
  const stats: [string, string][] = [
    ["Market Cap", fmtUsd(p.marketCap)],
    ["Fully Diluted Valuation", fmtUsd(p.fdv)],
    ["24h Trading Volume", fmtUsd(p.volume24h)],
    ["Circulating Supply", p.supply.circulating ? `${fmtNum(p.supply.circulating)} ${p.symbol}` : "—"],
    ["Max / Total Supply", fmtNum(p.supply.max ?? p.supply.total)],
    ["7d Range", last7.length ? `${fmtPrice(Math.min(...last7))} – ${fmtPrice(Math.max(...last7))}` : "—"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CoinIcon src={p.image} alt={p.name} size={32} />
            <h1 className="text-xl font-bold text-fg">{p.name}</h1>
            <span className="text-sm font-semibold text-subtle">{p.symbol} Price</span>
            {p.rank && <span className="rounded-md bg-surface-3 px-1.5 py-0.5 text-xs font-semibold text-muted">#{p.rank}</span>}
          </div>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="tabular text-4xl font-bold tracking-tight text-fg">{fmtPrice(p.price)}</span>
            <Pct value={p.change.d1} className="text-lg" />
            <span className="text-sm text-subtle">(24h)</span>
            <span
              className="text-xs text-subtle"
              title={p.priceLive ? "Live price from Binance (free, no CoinGecko call)." : "Not on Binance: CoinGecko price, cached for up to 12 hours to save API calls."}
            >
              {p.priceLive ? "● live" : "○ up to 12h old"}
            </span>
          </div>
          <div className="tabular mt-1 flex flex-wrap gap-3 text-sm text-muted">
            <span>
              7d <Pct value={p.change.d7} />
            </span>
            <span>
              30d <Pct value={p.change.d30} />
            </span>
            <span>
              1y <Pct value={p.change.y1} />
            </span>
            <span>
              ATH <Pct value={p.athChange} />
            </span>
          </div>
        </div>
        <div className="flex max-w-md flex-wrap justify-end gap-1.5">
          {rankCategories(p.categories)
            .slice(0, 5)
            .map((c) => (
              <Badge key={c} tone={p.trendingCategories.includes(c) ? "good" : "neutral"}>
                {p.trendingCategories.includes(c) ? "🔥 " : ""}
                {c}
              </Badge>
            ))}
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {stats.map(([k, v]) => (
          <div key={k} className="bg-surface px-3 py-2.5">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="tabular mt-0.5 truncate text-sm font-bold text-fg" title={v}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function RallySummary({ p }: { p: CoinProfile }) {
  const r = p.rally;
  if (!r) return <p className="text-sm text-muted">No 20%+ rally in the last 90 days. Current readings are shown.</p>;
  return (
    <p className="text-sm text-fg-2">
      <span className="font-semibold text-up">{fmtPct(r.gain)}</span> from {fmtPrice(r.lowPrice)} ({fmtDate(r.lowDate)}) to{" "}
      {fmtPrice(r.peakPrice)} ({fmtDate(r.peakDate)}) in {r.days} days. Breakout on <span className="text-warn">{fmtDate(r.breakoutDate)}</span> at{" "}
      {fmtPrice(r.breakoutPrice)}. {p.benchmark} did {fmtPct(r.benchmarkGain)} over the same window. Now {fmtPct(r.fromPeakNow)} from the peak.
    </p>
  );
}

const SNAPSHOT_ROWS: { label: string; hint: string; get: (s: Snapshot) => string }[] = [
  { label: "Market cap", hint: "", get: (s) => fmtUsd(s.marketCap) },
  { label: "Volume trend", hint: "7d avg ÷ prior 30d", get: (s) => fmtX(s.volTrend) },
  { label: "Turnover", hint: "7d avg vol ÷ mcap", get: (s) => fmtPct(s.turnover, { signed: false }) },
  { label: "vs 50-day avg", hint: "", get: (s) => fmtPct(s.vsSma50) },
  { label: "14d vs BTC", hint: "relative strength", get: (s) => fmtPct(s.relStrength14d) },
  { label: "From 180d high", hint: "", get: (s) => fmtPct(s.fromHigh) },
];

export function MetricsGrid({ p, showSetup }: { p: CoinProfile; showSetup: boolean }) {
  const f = p.fundamentals;
  const fixed: [string, string][] = [
    ["Circulating supply", fmtPct(p.supply.circulatingRatio, { signed: false })],
    ["FDV", fmtUsd(p.fdv)],
    ["30d volatility (ann.)", fmtPct(p.volatility30d, { signed: false })],
    ["From all-time high", fmtPct(p.athChange)],
    [f ? `TVL (${f.kind})` : "TVL", f ? `${fmtUsd(f.tvl)} (${fmtPct(f.tvlChange7d)} 7d)` : "Not DeFi / n/a"],
    ["Mcap ÷ TVL", fmtX(f?.mcapToTvl)],
    ["Fees (30d)", fmtUsd(f?.fees30d)],
    ["Commits (4 wks)", fmtNum(p.dev?.commits4w)],
  ];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <table className="tabular w-full text-sm">
        <thead className="whitespace-nowrap text-xs font-bold text-fg">
          <tr>
            <th className="py-1 text-left">Setup metric</th>
            {showSetup && <th className="py-1 text-right text-warn">At breakout</th>}
            <th className="py-1 text-right">Now</th>
          </tr>
        </thead>
        <tbody>
          {SNAPSHOT_ROWS.map((r) => (
            <tr key={r.label} className="border-t border-line">
              <td className="py-1.5 text-muted">
                {r.label} {r.hint && <span className="text-xs text-faint">({r.hint})</span>}
              </td>
              {showSetup && <td className="py-1.5 text-right text-fg">{r.get(p.setup)}</td>}
              <td className="py-1.5 text-right text-fg-2">{r.get(p.now)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="tabular w-full text-sm">
        <thead className="whitespace-nowrap text-xs font-bold text-fg">
          <tr>
            <th className="py-1 text-left">Supply & fundamentals</th>
            <th className="py-1 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {fixed.map(([k, v]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1.5 text-muted">{k}</td>
              <td className="py-1.5 text-right text-fg-2">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STRENGTH_TONE: Record<Strength, Tone> = { strong: "good", moderate: "warn", weak: "neutral" };

export function DriverList({ drivers }: { drivers: Driver[] }) {
  return (
    <ul className="space-y-2">
      {drivers.map((d) => (
        <li key={d.title} className="flex gap-3 text-sm">
          <span className="w-20 shrink-0 pt-0.5">
            <Badge tone={STRENGTH_TONE[d.strength]}>{d.strength}</Badge>
          </span>
          <span>
            <span className="font-medium text-fg">{d.title}.</span> <span className="text-muted">{d.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const SEVERITY_TONE: Record<RedFlag["severity"], Tone> = { high: "bad", medium: "warn", low: "neutral" };

export function RedFlagList({ flags }: { flags: RedFlag[] }) {
  if (!flags.length) return <p className="text-sm text-subtle">No red flags detected.</p>;
  return (
    <ul className="space-y-1.5">
      {flags.map((f) => (
        <li key={f.title} className="flex gap-3 text-sm">
          <span className="w-20 shrink-0 pt-0.5">
            <Badge tone={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
          </span>
          <span>
            <span className="font-medium text-fg">{f.title}.</span> <span className="text-muted">{f.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
