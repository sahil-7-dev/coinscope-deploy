"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MarketCoin, MarketPulse, PickedCoin, WatchItem } from "@/lib/types";
import { api } from "@/lib/api";
import { fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { addCoin, useCandidates, useWinners } from "@/lib/useStored";
import { Badge, Button, Card, CoinIcon, ErrorBox, PageHeader, Pct, Spinner, Tabs } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";

type View = "all" | "gainers" | "losers";
type Period = "h1" | "h24" | "d7" | "d30" | "y1";
const PERIODS: { value: Period; label: string }[] = [
  { value: "h1", label: "1h" },
  { value: "h24", label: "24h" },
  { value: "d7", label: "7d" },
  { value: "d30", label: "30d" },
  { value: "y1", label: "1y" },
];
const PAGE = 100;

export default function MarketPage() {
  const [data, setData] = useState<MarketPulse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHighlights, setShowHighlights] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api<MarketPulse>("/api/market")
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : "Failed to load market data"));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cryptocurrency Prices by Market Cap"
        subtitle={
          data ? (
            <>
              The global crypto market cap today is <b className="text-fg">{fmtUsd(data.global.totalMarketCap)}</b>, a <Pct value={data.global.change24h} /> change in
              the last 24 hours. Market mood: <b className="text-fg">{data.regime.label}</b>.
            </>
          ) : (
            "Live prices, trends and the coins leading the market."
          )
        }
        right={
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-muted">
            Highlights
            <button
              type="button"
              role="switch"
              aria-checked={showHighlights}
              onClick={() => setShowHighlights((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition ${showHighlights ? "bg-brand" : "bg-line-strong"}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${showHighlights ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </label>
        }
      />

      {error && <ErrorBox message={error} />}
      {!data && !error && <Spinner label="Loading market data…" />}

      {data && (
        <>
          {showHighlights && <Highlights data={data} />}
          <CoinsTable coins={data.coins} />
          <HotSectors data={data} />
        </>
      )}
    </div>
  );
}

// ---- Highlights row ----

function MiniList({ title, icon, coins, metric }: { title: string; icon: string; coins: { id: string; name: string; symbol: string; image: string; price?: number; change: number | null }[]; metric: string }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-base font-bold text-fg">
          {icon} {title}
        </h3>
        <span className="text-xs text-subtle">{metric}</span>
      </div>
      <ul className="space-y-1">
        {coins.map((c) => (
          <li key={c.id}>
            <Link href={`/coin/${c.id}`} className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-surface-2">
              <CoinIcon src={c.image} alt={c.name} />
              <span className="truncate font-semibold text-fg">{c.name}</span>
              <span className="text-xs text-subtle">{c.symbol}</span>
              <span className="tabular ml-auto text-fg-2">{c.price !== undefined ? fmtPrice(c.price) : ""}</span>
              <Pct value={c.change} className="w-14 justify-end text-xs" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  // Semicircle gauge: red (fear) → amber → green (greed).
  const angle = Math.PI * (1 - value / 100);
  const x = 50 + 38 * Math.cos(angle);
  const y = 50 - 38 * Math.sin(angle);
  return (
    <div className="flex items-center gap-3">
      <svg width="100" height="58" viewBox="0 0 100 58" aria-hidden>
        <defs>
          <linearGradient id="fg" x1="0" x2="1">
            <stop offset="0%" stopColor="#ea3943" />
            <stop offset="50%" stopColor="#f5a524" />
            <stop offset="100%" stopColor="#16c784" />
          </linearGradient>
        </defs>
        <path d="M12 50 A38 38 0 0 1 88 50" fill="none" stroke="url(#fg)" strokeWidth="8" strokeLinecap="round" />
        <circle cx={x} cy={y} r="6" fill="var(--surface)" stroke="var(--fg)" strokeWidth="2.5" />
      </svg>
      <div>
        <div className="tabular text-2xl font-bold text-fg">{value}</div>
        <div className="text-sm font-semibold text-muted">{label}</div>
      </div>
    </div>
  );
}

function Highlights({ data }: { data: MarketPulse }) {
  const liquid = data.coins.filter((c) => c.volume >= 1e6 && c.change.h24 !== null);
  const gainers = [...liquid].sort((a, b) => (b.change.h24 ?? 0) - (a.change.h24 ?? 0)).slice(0, 4);
  const trending = data.trending.slice(0, 4).map((t) => {
    const m = data.coins.find((c) => c.id === t.id);
    return { id: t.id, name: t.name, symbol: t.symbol, image: m?.image ?? t.thumb, price: m?.price, change: t.change24h };
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div className="grid gap-4">
        <Card className="p-4">
          <div className="tabular text-xl font-bold text-fg">{fmtUsd(data.global.totalMarketCap)}</div>
          <div className="mt-0.5 flex items-center gap-2 text-sm text-muted">
            Market Cap <Pct value={data.global.change24h} />
          </div>
        </Card>
        <Card className="p-4">
          <div className="tabular text-xl font-bold text-fg">{fmtUsd(data.global.totalVolume)}</div>
          <div className="mt-0.5 text-sm text-muted">24h Trading Volume</div>
        </Card>
      </div>
      <MiniList title="Trending" icon="🔥" coins={trending} metric="24h" />
      <MiniList title="Top Gainers" icon="🚀" coins={gainers.map((c) => ({ ...c, change: c.change.h24 }))} metric="24h" />
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-bold text-fg">🧭 Market Mood</h3>
          <Badge tone={data.regime.tone}>{data.regime.label}</Badge>
        </div>
        {data.fearGreed ? <FearGreedGauge value={data.fearGreed.value} label={data.fearGreed.label} /> : <p className="text-sm text-subtle">Fear & Greed unavailable</p>}
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-surface-2 p-2">
            <div className="text-subtle">Top 100 up (30d)</div>
            <div className="tabular font-bold text-fg">{fmtPct(data.breadth.up30d, { signed: false, digits: 0 })}</div>
          </div>
          <div className="rounded-lg bg-surface-2 p-2">
            <div className="text-subtle">Alts vs BTC (30d)</div>
            <Pct value={data.altVsBtc30d} className="font-bold" />
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---- Main coins table ----

function useWatchIds() {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    api<{ items: WatchItem[] }>("/api/watchlist")
      .then((r) => !cancelled && setIds(new Set(r.items.map((i) => i.id))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const toggle = (c: MarketCoin) => {
    const watching = ids.has(c.id);
    setIds((s) => {
      const next = new Set(s);
      if (watching) next.delete(c.id);
      else next.add(c.id);
      return next;
    });
    const req = watching
      ? api(`/api/watchlist?id=${encodeURIComponent(c.id)}`, { method: "DELETE" })
      : api("/api/watchlist", { body: { id: c.id, name: c.name, symbol: c.symbol, image: c.image } });
    req.catch(() => setIds((s) => new Set(watching ? [...s, c.id] : [...s].filter((x) => x !== c.id))));
  };
  return { ids, toggle };
}

function CoinsTable({ coins }: { coins: MarketCoin[] }) {
  const [view, setView] = useState<View>("all");
  const [period, setPeriod] = useState<Period>("h24");
  const [limit, setLimit] = useState(PAGE);
  const watch = useWatchIds();

  const rows = useMemo(() => {
    if (view === "all") return coins;
    const liquid = coins.filter((c) => c.volume >= 1e6 && c.change[period] !== null);
    const dir = view === "gainers" ? -1 : 1;
    return liquid.sort((a, b) => dir * ((a.change[period] ?? 0) - (b.change[period] ?? 0))).slice(0, 50);
  }, [coins, view, period]);
  const shown = rows.slice(0, limit);

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <Tabs<View>
          options={[
            { value: "all", label: "🪙 All Coins" },
            { value: "gainers", label: "🚀 Top Gainers" },
            { value: "losers", label: "📉 Top Losers" },
          ]}
          value={view}
          onChange={(v) => {
            setView(v);
            setLimit(PAGE);
          }}
        />
        {view !== "all" && <Tabs<Period> options={PERIODS} value={period} onChange={setPeriod} />}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="whitespace-nowrap text-xs font-bold text-fg">
            <tr className="border-b border-line">
              <th className="w-8 py-3 pl-4" />
              <th className="w-10 py-3 text-left">#</th>
              <th className="py-3 text-left">Coin</th>
              <th className="px-3 py-3 text-right">Price</th>
              <th className="px-3 py-3 text-right">1h</th>
              <th className="px-3 py-3 text-right">24h</th>
              <th className="px-3 py-3 text-right">7d</th>
              <th className="px-3 py-3 text-right">30d</th>
              <th className="px-3 py-3 text-right">24h Volume</th>
              <th className="px-3 py-3 text-right">Market Cap</th>
              <th className="px-3 py-3 text-right">Last 7 Days</th>
              <th className="py-3 pr-4 text-right">Analyze</th>
            </tr>
          </thead>
          <tbody className="tabular">
            {shown.map((c) => (
              <CoinRow key={c.id} c={c} watching={watch.ids.has(c.id)} onStar={() => watch.toggle(c)} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <div className="flex justify-center border-t border-line p-3">
          <Button variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </Button>
        </div>
      )}
    </Card>
  );
}

function CoinRow({ c, watching, onStar }: { c: MarketCoin; watching: boolean; onStar: () => void }) {
  const [winners, setWinners] = useWinners();
  const [candidates, setCandidates] = useCandidates();
  const picked: PickedCoin = { id: c.id, name: c.name, symbol: c.symbol, thumb: c.image };
  const isWinner = winners.some((w) => w.id === c.id);
  const isCandidate = candidates.some((w) => w.id === c.id);
  const trendUp = (c.change.d7 ?? 0) >= 0;

  return (
    <tr className="border-b border-line transition last:border-0 hover:bg-surface-2">
      <td className="py-3 pl-4">
        <button
          type="button"
          onClick={onStar}
          title={watching ? "Remove from watchlist" : "Add to watchlist"}
          className={`text-base leading-none transition ${watching ? "text-warn" : "text-faint hover:text-warn"}`}
        >
          {watching ? "★" : "☆"}
        </button>
      </td>
      <td className="py-3 text-muted">{c.rank ?? "—"}</td>
      <td className="py-3">
        <Link href={`/coin/${c.id}`} className="flex items-center gap-2.5">
          <CoinIcon src={c.image} alt={c.name} size={24} />
          <span className="font-bold text-fg hover:text-brand-strong">{c.name}</span>
          <span className="text-xs font-medium text-subtle">{c.symbol}</span>
        </Link>
      </td>
      <td className="px-3 py-3 text-right font-semibold text-fg">{fmtPrice(c.price)}</td>
      <td className="px-3 py-3 text-right">
        <Pct value={c.change.h1} />
      </td>
      <td className="px-3 py-3 text-right">
        <Pct value={c.change.h24} />
      </td>
      <td className="px-3 py-3 text-right">
        <Pct value={c.change.d7} />
      </td>
      <td className="px-3 py-3 text-right">
        <Pct value={c.change.d30} />
      </td>
      <td className="px-3 py-3 text-right text-fg-2">{fmtUsd(c.volume)}</td>
      <td className="px-3 py-3 text-right text-fg-2">{fmtUsd(c.marketCap)}</td>
      <td className="px-3 py-1.5">
        <div className="flex justify-end">
          <Sparkline values={c.sparkline} width={120} height={36} color={trendUp ? "var(--up)" : "var(--down)"} />
        </div>
      </td>
      <td className="py-3 pr-4">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            disabled={isWinner}
            onClick={() => setWinners((l) => addCoin(l, picked))}
            title="Use as a winner to learn from"
            className="whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-xs font-semibold text-fg-2 transition hover:bg-brand hover:text-black disabled:bg-up/15 disabled:text-up"
          >
            {isWinner ? "✓ W" : "+ W"}
          </button>
          <button
            type="button"
            disabled={isCandidate}
            onClick={() => setCandidates((l) => addCoin(l, picked))}
            title="Add as a candidate to score"
            className="whitespace-nowrap rounded-md bg-surface-3 px-2 py-1 text-xs font-semibold text-fg-2 transition hover:bg-brand hover:text-black disabled:bg-up/15 disabled:text-up"
          >
            {isCandidate ? "✓ C" : "+ C"}
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---- Sectors teaser ----

function HotSectors({ data }: { data: MarketPulse }) {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-line p-4">
        <div>
          <h2 className="text-lg font-bold text-fg">Top Categories Today</h2>
          <p className="text-sm text-muted">Sectors with $100M+ market cap, ranked by 24h market-cap change.</p>
        </div>
        <Link href="/narratives" className="text-sm font-semibold text-brand-strong hover:underline">
          Narratives →
        </Link>
      </div>
      <div className="grid sm:grid-cols-2">
        {data.hotCategories.map((c, i) => (
          <div key={c.id} className="flex items-center gap-3 border-b border-line px-4 py-3 text-sm sm:odd:border-r">
            <span className="tabular w-5 text-muted">{i + 1}</span>
            <span className="truncate font-semibold text-fg">{c.name}</span>
            <span className="ml-auto flex -space-x-1.5">
              {c.top3.map((src) => (
                <span key={src} className="rounded-full ring-2 ring-surface">
                  <CoinIcon src={src} alt="" size={18} />
                </span>
              ))}
            </span>
            <span className="tabular w-20 text-right text-xs text-muted">{fmtUsd(c.marketCap)}</span>
            <Pct value={c.change24h} className="w-14 justify-end" />
          </div>
        ))}
      </div>
    </Card>
  );
}
