"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import type { CoinProfile, CoinResearch, PickedCoin, ScorePoint, ThesisEvent, Tone, WatchItem } from "@/lib/types";
import { assumptionLabel, brokenFromHistory, thesisStatus } from "@/lib/analysis/thesis";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtPrice } from "@/lib/format";
import { Badge, Button, Card, CoinIcon, ErrorBox, Pct, SectionTitle, Spinner } from "@/components/ui";
import { CoinPicker } from "@/components/CoinPicker";
import { HORIZONS, MiniScores } from "@/components/ScoresPanel";

const NO_COINS: PickedCoin[] = [];
const VERDICT: Record<string, { label: string; tone: Tone }> = {
  strong: { label: "Strong candidate", tone: "good" },
  watch: { label: "Watchlist", tone: "neutral" },
  speculative: { label: "Speculative", tone: "warn" },
  avoid: { label: "Avoid", tone: "bad" },
};

/** The latest verdict change in a coin's snapshots, if any. */
function lastVerdictChange(history: ScorePoint[]): { from: string; to: string; at: string } | null {
  for (let i = history.length - 1; i > 0; i--) {
    const [prev, cur] = [history[i - 1].verdict, history[i].verdict];
    if (prev && cur && prev !== cur) return { from: prev, to: cur, at: history[i].takenAt };
  }
  return null;
}
const LINE_COLORS = { short: "#f59e0b", mid: "#3b82f6", long: "#16a34a", risk: "#ea3943" } as const;

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[] | null>(null);
  const [live, setLive] = useState<Record<string, CoinProfile>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [research, setResearch] = useState<Record<string, CoinResearch>>({});
  const [events, setEvents] = useState<Record<string, ThesisEvent[]>>({});

  useEffect(() => {
    let cancelled = false;
    api<{ items: WatchItem[] }>("/api/watchlist")
      .then(async (r) => {
        if (cancelled) return;
        setItems(r.items);
        const ids = r.items.map((w) => encodeURIComponent(w.id)).join(",");
        if (!ids) return;
        const res = await api<{ research: Record<string, CoinResearch>; events: Record<string, ThesisEvent[]> }>(`/api/research?ids=${ids}&events=1`);
        if (cancelled) return;
        setResearch(res.research);
        setEvents(res.events);
      })
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load watchlist")));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errMsg(err, "Action failed"));
    } finally {
      setBusy(null);
    }
  };

  const refresh = () =>
    act(`Re-analyzing ${items?.length ?? 0} coins…`, async () => {
      const res = await api<{ profiles: CoinProfile[]; errors: { id: string; message: string }[] }>("/api/watchlist/refresh", { method: "POST" });
      setLive(Object.fromEntries(res.profiles.map((p) => [p.id, p])));
      if (res.errors.length) throw new Error(`Couldn't refresh: ${res.errors.map((e) => e.id).join(", ")}`);
    });

  const add = (coins: PickedCoin[]) => {
    const c = coins[coins.length - 1];
    if (c) act(`Adding ${c.name}…`, () => api("/api/watchlist", { body: { id: c.id, name: c.name, symbol: c.symbol, image: c.thumb } }));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">Watchlist</h1>
          <p className="mt-1 max-w-4xl text-base text-muted">
            Track coins over time. Every analysis records a score snapshot (at most every 6 hours), so refresh regularly to build each coin&apos;s history.
          </p>
        </div>
        <Button onClick={refresh} disabled={!items?.length || busy !== null}>
          ↻ Refresh all scores
        </Button>
      </div>

      <Card>
        <SectionTitle title="Add a coin" />
        <CoinPicker value={NO_COINS} onChange={add} placeholder="Search a coin to watch…" />
      </Card>

      {busy && <Spinner label={busy} />}
      {error && <ErrorBox message={error} />}
      {!items && !error && <Spinner label="Loading watchlist…" />}
      {items?.length === 0 && <p className="text-sm text-subtle">Nothing on your watchlist yet.</p>}

      {items && items.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
                <tr className="border-b border-line">
                  <th className="px-4 py-2">Coin</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2">Verdict</th>
                  <th className="px-3 py-2" title="Your thesis: stance, assumptions that broke, and whether a review is due">
                    Thesis
                  </th>
                  <th className="px-3 py-2">Latest scores</th>
                  <th className="px-3 py-2">Score history</th>
                  <th className="px-3 py-2">Since first snapshot</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <WatchRow
                    key={w.id}
                    w={w}
                    live={live[w.id]}
                    research={research[w.id]}
                    events={events[w.id] ?? []}
                    disabled={busy !== null}
                    onRemove={() => act(`Removing ${w.name}…`, () => api(`/api/watchlist?id=${encodeURIComponent(w.id)}`, { method: "DELETE" }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-4 px-4 py-3 text-xs text-subtle">
            {HORIZONS.map((h) => (
              <span key={h.key} className="inline-flex items-center gap-1.5">
                <span className="h-0.5 w-4" style={{ background: LINE_COLORS[h.key] }} /> {h.title}
              </span>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function WatchRow({
  w,
  live,
  research,
  events,
  disabled,
  onRemove,
}: {
  w: WatchItem;
  live?: CoinProfile;
  research?: CoinResearch;
  events: ThesisEvent[];
  disabled: boolean;
  onRemove: () => void;
}) {
  const last = w.history[w.history.length - 1];
  const first = w.history[0];
  const delta = (k: keyof Omit<ScorePoint, "takenAt" | "price">) =>
    first && last && first[k] !== null && last[k] !== null && w.history.length > 1 ? (last[k] as number) - (first[k] as number) : null;
  const chartData = useMemo(() => w.history.map((h) => ({ ...h, label: fmtDate(h.takenAt) })), [w.history]);
  const verdict = last?.verdict ? VERDICT[last.verdict] : null;
  const change = lastVerdictChange(w.history);

  return (
    <tr className="border-b border-line align-middle">
      <td className="px-4 py-2.5">
        <Link href={`/coin/${w.id}`} className="flex items-center gap-2 hover:text-brand-strong">
          <CoinIcon src={live?.image ?? w.image} alt={w.name} />
          <span className="text-fg">{w.name}</span>
          <span className="text-subtle">{w.symbol}</span>
        </Link>
      </td>
      <td className="tabular px-3 py-2.5 text-right">
        {fmtPrice(live?.price ?? last?.price)}
        {first && last && w.history.length > 1 && (
          <div className="text-xs">
            <Pct value={last.price / first.price - 1} />
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        {verdict ? <Badge tone={verdict.tone}>{verdict.label}</Badge> : <span className="text-xs text-subtle">—</span>}
        {change && (
          <div className="mt-1 text-xs text-muted" title="Verdict from data only; your research ratings aren't included here.">
            {VERDICT[change.from]?.label ?? change.from} → <b className="text-fg-2">{VERDICT[change.to]?.label ?? change.to}</b> on {fmtDate(change.at)}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5">
        <ThesisCell research={research} events={events} live={live} />
      </td>
      <td className="px-3 py-2.5">
        {live ? (
          <MiniScores scores={live.scores} />
        ) : last ? (
          <span className="tabular text-xs text-fg-2">
            S {last.short ?? "–"} · M {last.mid ?? "–"} · L {last.long ?? "–"} · R {last.risk ?? "–"}
          </span>
        ) : (
          <span className="text-xs text-subtle">Refresh to score</span>
        )}
      </td>
      <td className="px-3 py-1">
        {chartData.length > 1 ? (
          <div className="h-10 w-44">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <YAxis domain={[0, 100]} hide />
                {(["short", "mid", "long", "risk"] as const).map((k) => (
                  <Line key={k} dataKey={k} stroke={LINE_COLORS[k]} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
                ))}
                <Tooltip
                  content={({ active, payload }) => {
                    const pt = active && payload?.[0] ? (payload[0].payload as ScorePoint & { label: string }) : null;
                    return pt ? (
                      <div className="rounded border border-line bg-surface px-2 py-1 text-xs">
                        {pt.label}: S {pt.short ?? "–"} · M {pt.mid ?? "–"} · L {pt.long ?? "–"} · R {pt.risk ?? "–"}
                      </div>
                    ) : null;
                  }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <span className="text-xs text-faint">{w.history.length} snapshot{w.history.length === 1 ? "" : "s"}</span>
        )}
      </td>
      <td className="tabular px-3 py-2.5 text-xs text-muted">
        {w.history.length > 1 ? (
          <>
            {(["short", "mid", "long"] as const).map((k) => {
              const d = delta(k);
              return (
                <span key={k} className="mr-2">
                  {k[0].toUpperCase()} <span className={d === null ? "" : d > 0 ? "text-up" : d < 0 ? "text-down" : ""}>{d === null ? "–" : `${d > 0 ? "+" : ""}${d}`}</span>
                </span>
              );
            })}
            <div className="text-faint">since {fmtDate(first.takenAt)}</div>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onRemove}>
          Remove
        </Button>
      </td>
    </tr>
  );
}

const STANCE: Record<string, Tone> = { bullish: "good", neutral: "neutral", bearish: "bad" };

/** Your thesis at a glance: stance, broken assumptions (live after a refresh, else from the last logged check), review due. */
function ThesisCell({ research, events, live }: { research?: CoinResearch; events: ThesisEvent[]; live?: CoinProfile }) {
  const t = research?.thesis;
  if (!t || !(t.stance || t.summary.trim() || t.assumptions.length)) {
    return <span className="text-xs text-subtle">No thesis yet</span>;
  }
  const broken = live ? thesisStatus(research, live).broken.map((b) => b.assumption) : brokenFromHistory(research, events);
  const due = !!t.reviewOn && t.reviewOn <= new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {t.stance && <Badge tone={STANCE[t.stance]}>{t.stance[0].toUpperCase() + t.stance.slice(1)}</Badge>}
        <span className="text-muted">
          {t.assumptions.length} assumption{t.assumptions.length === 1 ? "" : "s"}
        </span>
      </div>
      {broken.length > 0 && (
        <div className="text-down" title={broken.map(assumptionLabel).join("; ")}>
          {broken.length} broken: {assumptionLabel(broken[0])}
          {broken.length > 1 ? "…" : ""}
        </div>
      )}
      {due && <div className="text-warn">Review due ({t.reviewOn})</div>}
    </div>
  );
}
