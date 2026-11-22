"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { NarrativeCoin, NarrativeDetail, NarrativeStage, NarrativeStat } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtPct, fmtUsd, fmtX } from "@/lib/format";
import { Card, CoinIcon, ErrorBox, PageHeader, Pct, SectionTitle, Spinner, Stat } from "@/components/ui";
import { ATTENTION, AttentionBadge, STAGES, StageBadge, stageSinceLabel } from "@/components/NarrativeBadge";
import { IndexVsBtcChart, StageStrip } from "@/components/NarrativeCharts";

export function NarrativeView() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<NarrativeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<NarrativeDetail>(`/api/narratives/${id}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load the narrative")));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const s = data?.stat;
  return (
    <div className="space-y-6">
      <Link href="/narratives" className="text-sm font-semibold text-brand-strong hover:underline">
        ← All narratives
      </Link>
      {error && <ErrorBox message={error} />}
      {!data && !error && <Spinner label="Loading the narrative and scoring its coins from DefiLlama data…" />}

      {data && s && (
        <>
          <PageHeader
            title={s.name}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <StageBadge stage={s.stage} />
                <AttentionBadge attention={s.attention} />
                {s.trending && <span className="text-xs font-semibold text-brand-strong">Trending on CoinGecko</span>}
                {s.stageSince && (
                  <span className="text-sm text-muted">
                    {s.stage} {sinceText(data)}
                    {s.previousStage ? ` (was ${s.previousStage})` : ""}
                  </span>
                )}
              </span>
            }
          />
          {s.stage && <p className="-mt-3 text-sm text-muted">{STAGES[s.stage].meaning}</p>}

          <Tiles s={s} market={data.marketFees} />

          {s.signals.length > 0 && (
            <Card>
              <SectionTitle title="Why this stage" subtitle="Fundamentals first; the market phase is context only." />
              <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
                {s.signals.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              {s.attention && <p className="mt-2 text-xs text-subtle">Attention ({s.attention}): {ATTENTION[s.attention].meaning}</p>}
            </Card>
          )}

          <CoinsTable coins={data.coins} />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <SectionTitle title="Stage over the last year" subtitle="Rebuilt each day from data known on that day. A new stage has to hold for 20 days." />
              <StageStrip days={s.stageHistory} />
              <StageChanges days={s.stageHistory} />
            </Card>
            <Card>
              <SectionTitle title="Index vs BTC over the last year" subtitle="Market attention, shown as context; it never changes the stage or a score." />
              <IndexVsBtcChart history={s.history} />
            </Card>
          </div>

          {data.track && <TrackRecord track={data.track} stageResults={data.stageResults} />}

          <div className="grid gap-4 lg:grid-cols-2">
            <BuilderSources sources={data.builderSources} />
            <Headlines items={data.headlines} />
          </div>
        </>
      )}
    </div>
  );
}

/** When the current stage began: from the full replayed history when it agrees, else from the last year. */
function sinceText(d: NarrativeDetail): string | null {
  const last = d.track?.calls[d.track.calls.length - 1];
  if (last?.ongoing && last.to === d.stat.stage) return `since ${fmtDate(last.date)} ${last.date.slice(0, 4)}`;
  return stageSinceLabel(d.stat);
}

function Tiles({ s, market }: { s: NarrativeStat; market: NarrativeDetail["marketFees"] }) {
  const f = s.fundamentals;
  const b = s.builders;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Fee growth (30d)" value={<Pct value={f.feeGrowth30d} />} sub={`Market median ${fmtPct(market.g30, { signed: true })}`} />
      <Stat label="Fee growth (90d)" value={<Pct value={f.feeGrowth90d} />} sub={`Market median ${fmtPct(market.g90, { signed: true })}`} />
      <Stat label="Coins with growing fees" value={f.withFees ? `${f.growing} of ${f.withFees}` : "—"} sub="Over 90 days, among its fee earners" />
      <Stat label="New protocols (90d)" value={b ? b.last90 : "—"} sub={b ? `${b.prev90} in the 90 days before` : "No DefiLlama categories matched"} />
      <Stat
        label="Headline mentions"
        value={s.mentions ?? "—"}
        sub={s.mentionTrend ? `${s.mentionTrend.last7} this week vs ${s.mentionTrend.prev7} the week before` : "Weekly trend after 14 days of saved counts"}
      />
    </div>
  );
}

/** Each day the confirmed stage changed during the year, newest first. */
function StageChanges({ days }: { days: NarrativeStat["stageHistory"] }) {
  const changes: { date: string; from: NarrativeStage | null; to: NarrativeStage }[] = [];
  for (let i = 1; i < days.length; i++) {
    const to = days[i].stage;
    if (to && to !== days[i - 1].stage) changes.push({ date: days[i].date, from: days[i - 1].stage, to });
  }
  if (!changes.length) return <p className="mt-3 text-sm text-muted">No stage changes in the last year.</p>;
  return (
    <ul className="mt-3 space-y-1 text-sm">
      {changes.reverse().map((c) => (
        <li key={c.date} className="flex items-center gap-2">
          <span className="w-24 text-muted">
            {fmtDate(c.date)} {c.date.slice(0, 4)}
          </span>
          {c.from ? <StageBadge stage={c.from} /> : <span className="text-xs text-subtle">no data</span>}
          <span className="text-subtle">→</span>
          <StageBadge stage={c.to} />
        </li>
      ))}
    </ul>
  );
}

function CoinsTable({ coins }: { coins: NarrativeCoin[] }) {
  const top = coins.slice(0, 10).map((c) => c.id);
  return (
    <Card>
      <SectionTitle
        title="Its coins, ranked by fundamentals"
        subtitle="Quick score from DefiLlama fees, value capture, valuation and the narrative's stage only. The full 8-category scorecard and verdict are on each coin's page or in Coin Check. The 30-day price change is context, not scored."
        right={
          top.length > 0 && (
            <Link href={`/similarity?coins=${top.join(",")}`} className="text-sm font-semibold text-brand-strong hover:underline">
              Check the top {top.length} in Coin Check →
            </Link>
          )
        }
      />
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[720px] text-sm">
          <thead className="text-left text-xs font-bold text-fg">
            <tr className="border-b border-line">
              <th className="py-1.5">#</th>
              <th className="py-1.5">Coin</th>
              <th className="py-1.5">Quick score</th>
              <th className="py-1.5 text-right">Fees (30d)</th>
              <th className="py-1.5 text-right">Fee growth (90d)</th>
              <th className="py-1.5 text-right">To holders</th>
              <th className="py-1.5 text-right">P/F</th>
              <th className="py-1.5 text-right">Market cap</th>
              <th className="py-1.5 text-right">Price 30d</th>
            </tr>
          </thead>
          <tbody>
            {coins.map((c, i) => (
              <tr key={c.id} className="border-b border-line">
                <td className="py-1.5 text-muted">{i + 1}</td>
                <td className="py-1.5">
                  <Link href={`/coin/${c.id}`} className="flex items-center gap-2 hover:underline">
                    <CoinIcon src={c.image} alt={c.symbol} />
                    <span className="font-semibold text-fg">{c.symbol}</span>
                    <span className="truncate text-muted">{c.name}</span>
                    {c.inIndex && <span className="text-xs text-subtle">index</span>}
                  </Link>
                </td>
                <td className="py-1.5">
                  {c.quickScore === null ? (
                    <span className="text-subtle">—</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-3">
                        <span className="block h-full rounded-full bg-brand" style={{ width: `${c.quickScore}%` }} />
                      </span>
                      <span className="font-semibold text-fg-2">{c.quickScore}</span>
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right text-fg-2">{c.hasFees ? fmtUsd(c.fees30d) : <span className="text-xs text-subtle">no fee data</span>}</td>
                <td className="py-1.5 text-right">
                  <Pct value={c.feesGrowth90d} />
                </td>
                <td className="py-1.5 text-right text-fg-2">{fmtPct(c.holderShare)}</td>
                <td className="py-1.5 text-right text-fg-2">{fmtX(c.priceToFees)}</td>
                <td className="py-1.5 text-right text-muted">{fmtUsd(c.marketCap)}</td>
                <td className="py-1.5 text-right">
                  <Pct value={c.change30d} className="opacity-70" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle">
        Coins without DefiLlama fee data are listed last: no fees isn&apos;t a bad sign on its own (chains, infrastructure), it just can&apos;t be scored here.
      </p>
    </Card>
  );
}

/** Every stage change in the narrative's history and what its coins did over the next 90 days. */
function TrackRecord({ track, stageResults }: { track: NonNullable<NarrativeDetail["track"]>; stageResults: NarrativeDetail["stageResults"] }) {
  const calls = [...track.calls].reverse();
  const SHOWN = 12;
  return (
    <Card>
      <SectionTitle
        title="Stage track record"
        subtitle={`Every stage change since ${track.calls[0]?.date.slice(0, 4) ?? "its data began"}, replayed from data known at the time, and how its coins did next. About ${track.changesPerYear.toFixed(1)} changes a year.`}
        right={
          <Link href="/backtest#stage-check" className="text-sm font-semibold text-brand-strong hover:underline">
            All narratives →
          </Link>
        }
      />
      {calls.length === 0 ? (
        <p className="text-sm text-muted">Its stage hasn&apos;t changed in the replayed history (usually: too little fee data).</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabular w-full min-w-[620px] text-sm">
            <thead className="text-left text-xs font-bold text-fg">
              <tr className="border-b border-line">
                <th className="py-1.5">Confirmed</th>
                <th className="py-1.5">Change</th>
                <th className="py-1.5 text-right">Lasted</th>
                <th className="py-1.5 text-right">Next 90d vs BTC</th>
                <th className="py-1.5 text-right">vs typical narrative</th>
                <th className="py-1.5 text-right">Typical for this stage</th>
              </tr>
            </thead>
            <tbody>
              {calls.slice(0, SHOWN).map((c) => (
                <tr key={c.date} className="border-b border-line">
                  <td className="py-1.5 text-muted">
                    {fmtDate(c.date)} {c.date.slice(0, 4)}
                  </td>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      {c.from ? <StageBadge stage={c.from} /> : <span className="text-xs text-subtle">no data</span>}
                      <span className="text-subtle">→</span>
                      <StageBadge stage={c.to} />
                    </span>
                  </td>
                  <td className="py-1.5 text-right text-fg-2">{c.ongoing ? `${c.days} days, ongoing` : `${c.days} days`}</td>
                  <td className="py-1.5 text-right">{c.vsBtc90 === null ? <span className="text-xs text-subtle">too recent</span> : <Pct value={c.vsBtc90} />}</td>
                  <td className="py-1.5 text-right">
                    <Pct value={c.vsOthers90} />
                  </td>
                  <td className="py-1.5 text-right">
                    <Pct value={stageResults?.find((s) => s.stage === c.to)?.vsOthers90 ?? null} className="opacity-70" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-subtle">
        &quot;Typical for this stage&quot; is the median across all narratives. Past stage changes haven&apos;t reliably predicted which narratives do better next; see the
        stage check for the full picture.
      </p>
    </Card>
  );
}

function BuilderSources({ sources }: { sources: NarrativeDetail["builderSources"] }) {
  return (
    <Card>
      <SectionTitle title="Where its builder count comes from" subtitle="New protocols DefiLlama started tracking in its coins' categories and chains: last 90 days vs the 90 before." />
      {sources.length === 0 ? (
        <p className="text-sm text-muted">None of its coins map to a DefiLlama category or chain.</p>
      ) : (
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs font-bold text-fg">
            <tr className="border-b border-line">
              <th className="py-1.5">Source</th>
              <th className="py-1.5 text-right">Last 90d</th>
              <th className="py-1.5 text-right">Prior 90d</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((x) => (
              <tr key={`${x.kind}:${x.name}`} className="border-b border-line">
                <td className="py-1.5 text-fg">
                  {x.name} <span className="text-xs text-subtle">{x.kind}</span>
                </td>
                <td className="py-1.5 text-right font-semibold text-fg-2">{x.last90}</td>
                <td className="py-1.5 text-right text-muted">{x.prev90}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Headlines({ items }: { items: NarrativeDetail["headlines"] }) {
  return (
    <Card>
      <SectionTitle title="Recent headlines" subtitle="Mentioning the narrative or one of its index coins. Attention, not fundamentals." />
      {items.length === 0 ? (
        <p className="text-sm text-muted">No recent headlines mention it.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {items.slice(0, 12).map((n) => (
            <li key={n.url}>
              <a href={n.url} target="_blank" rel="noreferrer" className="text-fg hover:underline">
                {n.title}
              </a>
              <div className="text-xs text-subtle">
                {n.source} · {fmtDate(n.publishedAt.slice(0, 10))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
