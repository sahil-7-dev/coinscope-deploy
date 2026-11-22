"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import type { NarrativeAttention, NarrativeChange, NarrativePhase, NarrativeStage, NarrativeStat, NarrativesResponse } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { useChartColors } from "@/lib/theme";
import { fmtDate, fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { Card, CoinIcon, ErrorBox, PageHeader, Pct, SectionTitle, Spinner } from "@/components/ui";
import { IndexVsBtcChart } from "@/components/NarrativeCharts";
import { useStageCheck } from "@/components/StageCheck";
import { stageFinding } from "@/lib/analysis/stage-check";
import { ATTENTION, AttentionBadge, PHASE_ORDER, PHASES, PhaseBadge, STAGE_ORDER, STAGES, StageBadge, stageSinceLabel } from "@/components/NarrativeBadge";
import { Sparkline } from "@/components/Sparkline";

export default function NarrativesPage() {
  const [data, setData] = useState<NarrativesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<NarrativesResponse>("/api/narratives")
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load narratives")));
    return () => {
      cancelled = true;
    };
  }, []);

  const inStage = (...stages: NarrativeStage[]) => (data?.sectors ?? []).filter((s) => s.stage && stages.includes(s.stage));
  /** Unnoticed first: fundamentals improving while prices haven't moved is the sweet spot. */
  const ATTENTION_ORDER: NarrativeAttention[] = ["Unnoticed", "Noticed", "Crowded"];
  const byAttention = (list: NarrativeStat[]) => [...list].sort((a, b) => ATTENTION_ORDER.indexOf(a.attention ?? "Noticed") - ATTENTION_ORDER.indexOf(b.attention ?? "Noticed"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Narratives"
        subtitle="Where fundamentals improve before the crowd notices. A narrative's stage uses fundamentals only: its biggest coins' fees vs the whole market's, and new protocols launching around them (DefiLlama). Market attention (price vs BTC) is shown beside it as context and never scored."
      />

      {error && <ErrorBox message={error} />}
      {!data && !error && <Spinner label="Building narrative indexes (the first load downloads years of prices and can take a few minutes; cached after)…" />}

      {data && (
        <>
          {data.marketFees && (
            <p className="text-sm text-muted">
              Market-wide fee growth (median of every tracked coin): <b className="text-fg">{fmtPct(data.marketFees.g90)}</b> over 90 days,{" "}
              <b className="text-fg">{fmtPct(data.marketFees.g30)}</b> over 30 days. A narrative only counts as growing if its coins beat that.
            </p>
          )}
          <StageCheckNote />
          <RecentChanges changes={data.changes ?? []} />

          <div className="grid gap-4 lg:grid-cols-3">
            <PhaseColumn
              title="Fundamentals improving"
              subtitle="Emerging or accelerating: fees beating the market, or builders arriving. A place to start researching, not a buy signal on its own."
              sectors={byAttention(inStage("Emerging", "Accelerating"))}
              empty="No narrative's fees are beating the market's right now."
            />
            <PhaseColumn title="Quiet" subtitle="No fundamental signal either way. Strong coins here can still be early." sectors={byAttention(inStage("Quiet"))} empty="None right now." />
            <PhaseColumn
              title="Slowing or fading"
              subtitle="A strong quarter that slowed, or fees shrinking against the market."
              sectors={inStage("Maturing", "Fading")}
              empty="None right now."
            />
          </div>

          {data.builders && <Builders builders={data.builders} />}

          <Card>
            <SectionTitle
              title="Market rotation (context)"
              subtitle={
                <>
                  Right = beat BTC over 30 days. Up = beat BTC over the last 7 days. BTC itself: <Pct value={data.btc.d7} /> 7d, <Pct value={data.btc.d30} /> 30d.
                </>
              }
            />
            <RotationChart sectors={data.sectors} />
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
              {PHASE_ORDER.map((k) => (
                <div key={k} className="flex items-center gap-2 text-muted">
                  <PhaseBadge phase={k} /> {PHASES[k].meaning}
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-4 border-t border-line pt-3 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-bold text-fg">Stages (fundamentals only)</h3>
                <div className="mt-2 grid gap-2 text-xs">
                  {STAGE_ORDER.map((k) => (
                    <div key={k} className="flex items-center gap-2 text-muted">
                      <StageBadge stage={k} /> {STAGES[k].meaning}
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-bold text-fg">Attention (market context, not scored)</h3>
                <div className="mt-2 grid gap-2 text-xs">
                  {(Object.keys(ATTENTION) as NarrativeAttention[]).map((k) => (
                    <div key={k} className="flex items-center gap-2 text-muted">
                      <AttentionBadge attention={k} /> {ATTENTION[k].meaning}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="p-4 pb-2">
              <SectionTitle title="All narratives" subtitle="Click a row for the reasons behind its stage, its coins and a year of performance vs BTC." />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2">Narrative</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2" title="Market attention from price vs BTC: context only">
                      Attention
                    </th>
                    <th className="px-3 py-2 text-right" title="New protocols launched in its coins' DefiLlama categories and chains: last 90 days (prior 90)">
                      Builders 90d
                    </th>
                    <th className="px-3 py-2 text-right" title="Median 90-day fee growth across its coins that earn fees">
                      Fees 90d
                    </th>
                    <th className="px-3 py-2 text-right" title="Its coins with fee data whose fees grew over 90 days">
                      Growing
                    </th>
                    <th className="px-3 py-2 text-right" title="Recent headlines mentioning the narrative or its coins">
                      News
                    </th>
                    <th className="px-3 py-2">Market phase</th>
                    <th className="px-3 py-2 text-right">vs BTC 30d</th>
                    <th className="px-3 py-2 text-right">90d</th>
                    <th className="px-3 py-2">1 year vs BTC</th>
                    <th className="px-3 py-2 text-right">Mkt cap</th>
                  </tr>
                </thead>
                <tbody className="tabular">
                  {data.sectors.map((s) => {
                    const isOpen = open === s.id;
                    const ratios = s.history.map((h) => h.ratio);
                    return (
                      <Fragment key={s.id}>
                        <tr onClick={() => setOpen(isOpen ? null : s.id)} className={`cursor-pointer border-b border-line hover:bg-surface-2 ${isOpen ? "bg-surface-2" : ""}`}>
                          <td className="px-4 py-2 text-fg">
                            <Link href={`/narratives/${s.id}`} onClick={(e) => e.stopPropagation()} className="hover:text-brand-strong hover:underline">
                              {s.name}
                            </Link>
                            {s.trending && <span className="ml-2 text-xs text-up">● trending</span>}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <StageBadge stage={s.stage} />
                            {s.stageSince && <span className="ml-1.5 text-xs text-subtle">{stageSinceLabel(s)}</span>}
                          </td>
                          <td className="px-3 py-2">
                            <AttentionBadge attention={s.attention} />
                          </td>
                          <td className="px-3 py-2 text-right text-muted">
                            {s.builders ? (
                              <>
                                <span className="text-fg-2">{s.builders.last90}</span> <span className="text-xs">({s.builders.prev90})</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold">
                            <Pct value={s.fundamentals.feeGrowth90d} />
                          </td>
                          <td className="px-3 py-2 text-right text-muted">{s.fundamentals.withFees ? `${s.fundamentals.growing}/${s.fundamentals.withFees}` : "—"}</td>
                          <td className="px-3 py-2 text-right text-muted" title={s.mentionTrend ? `Last 7 days: ${s.mentionTrend.last7}, the 7 before: ${s.mentionTrend.prev7}` : "Trend appears after 14 days of saved counts"}>
                            {s.mentions ?? "—"}
                            {s.mentionTrend && s.mentionTrend.last7 > s.mentionTrend.prev7 && <span className="ml-1 text-xs text-up">▲</span>}
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <PhaseBadge phase={s.phase} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Pct value={s.reading.rel30} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Pct value={s.reading.rel90} />
                          </td>
                          <td className="px-3 py-1">
                            <Sparkline values={ratios} width={110} height={28} color={ratios[ratios.length - 1] >= 1 ? "var(--up)" : "var(--down)"} />
                          </td>
                          <td className="px-3 py-2 text-right text-fg-2">{fmtUsd(s.marketCap)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-line">
                            <td colSpan={12} className="bg-surface-2 px-4 py-4">
                              <NarrativeDetail s={s} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-3 text-sm text-subtle">
              Updated {new Date(data.updatedAt).toLocaleTimeString()}. A stage needs fee data for at least 2 of a narrative&apos;s coins, or builders arriving; it must hold
              20 days before it changes (shorter holds flipped too often: see the <Link href="/backtest#stage-check" className="text-brand-strong hover:underline">stage check</Link>). Stages feed each coin&apos;s fundamental score; attention only appears in verdicts as a market-context warning.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

/** Cards shown per column; the rest are in the table below. */
const COLUMN_MAX = 6;

function PhaseColumn({ title, subtitle, sectors, empty }: { title: string; subtitle: string; sectors: NarrativeStat[]; empty: string }) {
  return (
    <Card>
      <SectionTitle title={title} subtitle={subtitle} />
      {sectors.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="space-y-3">
          {sectors.slice(0, COLUMN_MAX).map((s) => (
            <li key={s.id} className="rounded-xl border border-line p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/narratives/${s.id}`} className="font-semibold text-fg hover:text-brand-strong hover:underline">
                  {s.name}
                </Link>
                <span className="flex items-center gap-1.5">
                  <StageBadge stage={s.stage} />
                  <AttentionBadge attention={s.attention} />
                  {s.stageSince && <span className="text-xs text-subtle">{stageSinceLabel(s)}</span>}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm text-fg-2">
                {s.signals.map((sig) => (
                  <li key={sig}>• {sig}</li>
                ))}
              </ul>
              <MemberChips s={s} max={6} />
            </li>
          ))}
          {sectors.length > COLUMN_MAX && <li className="text-sm text-muted">…and {sectors.length - COLUMN_MAX} more in the table below.</li>}
        </ul>
      )}
    </Card>
  );
}

function MemberChips({ s, max }: { s: NarrativeStat; max?: number }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
      {s.members.slice(0, max).map((m) => (
        <Link key={m.id} href={`/coin/${m.id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-fg-2 hover:text-brand-strong">
          <CoinIcon src={m.image} alt={m.name} size={14} />
          {m.symbol} <Pct value={m.change30d} />
        </Link>
      ))}
    </div>
  );
}

function NarrativeDetail({ s }: { s: NarrativeStat }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-bold text-fg">Why it&apos;s {s.stage ? s.stage.toLowerCase() : "unclassified"}</h4>
          <ul className="mt-1 space-y-1 text-sm text-fg-2">
            {s.signals.length ? s.signals.map((sig) => <li key={sig}>• {sig}</li>) : <li className="text-muted">Not enough data.</li>}
          </ul>
        </div>
        {s.stageHistory?.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-fg">Stage over the last 90 days</h4>
            <StageTimeline s={s} />
          </div>
        )}
        <div>
          <h4 className="text-sm font-bold text-fg">Index coins (30d change)</h4>
          <MemberChips s={s} />
        </div>
      </div>
      <div>
        <h4 className="text-sm font-bold text-fg">Index vs BTC over the last year</h4>
        <IndexVsBtcChart history={s.history} />
        <Link href={`/narratives/${s.id}`} className="mt-2 inline-block text-sm font-semibold text-brand-strong hover:underline">
          Open the full narrative →
        </Link>
      </div>
    </div>
  );
}

function RotationChart({ sectors }: { sectors: NarrativeStat[] }) {
  const c = useChartColors();
  const points = sectors
    .filter((s) => s.reading.rel7 !== null && s.reading.rel30 !== null && s.phase)
    .map((s) => ({ name: s.name, x: (s.reading.rel30 as number) * 100, y: (s.reading.rel7 as number) * 100, phase: s.phase as NarrativePhase, label: "" }));
  // Label only the sectors farthest from the center; the crowded middle stays readable (hover shows every name).
  [...points]
    .sort((a, b) => Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y))
    .slice(0, 8)
    .forEach((p) => (p.label = p.name));
  return (
    <div className="h-80">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 0 }}>
          <CartesianGrid stroke={c.grid} />
          <XAxis type="number" dataKey="x" name="vs BTC 30d" unit="%" tick={{ fill: c.axis, fontSize: 11 }} />
          <YAxis type="number" dataKey="y" name="vs BTC 7d" unit="%" tick={{ fill: c.axis, fontSize: 11 }} width={48} />
          <ReferenceLine x={0} stroke={c.cursor} />
          <ReferenceLine y={0} stroke={c.cursor} />
          <Tooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const p = active && payload?.[0] ? (payload[0].payload as (typeof points)[number]) : null;
              return p ? (
                <div className="rounded border border-line bg-surface px-2 py-1 text-xs">
                  <div className="text-fg">
                    {p.name} · {p.phase}
                  </div>
                  <div className="text-muted">
                    vs BTC: {p.x.toFixed(1)}% (30d), {p.y.toFixed(1)}% (7d)
                  </div>
                </div>
              ) : null;
            }}
          />
          {PHASE_ORDER.map((phase) => (
            <Scatter key={phase} data={points.filter((p) => p.phase === phase)} fill={PHASES[phase].color} isAnimationActive={false}>
              <LabelList dataKey="label" position="top" style={{ fill: c.axis, fontSize: 10 }} />
            </Scatter>
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stage changes in the last 30 days: the moments early detection is about. */
function RecentChanges({ changes }: { changes: NarrativeChange[] }) {
  const tone = (c: NarrativeChange) =>
    c.to === "Emerging" || c.to === "Accelerating" ? "border-up/40 bg-up/5" : c.to === "Fading" || c.to === "Maturing" ? "border-down/30 bg-down/5" : "border-line";
  return (
    <Card>
      <SectionTitle
        title="Recent stage changes"
        subtitle="Last 30 days, newest first. Green = fundamentals starting to improve (the moment to research its coins); red = slowing or fading."
      />
      {changes.length === 0 ? (
        <p className="text-sm text-muted">No narrative changed stage in the last 30 days.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {changes.slice(0, 12).map((c) => (
            <li key={`${c.id}-${c.date}`} className={`flex flex-wrap items-center gap-1.5 rounded-lg border px-3 py-2 text-sm ${tone(c)}`}>
              <span className="font-semibold text-fg">{c.sector}</span>
              <StageBadge stage={c.from} />
              <span className="text-subtle">→</span>
              <StageBadge stage={c.to} />
              <span className="ml-auto text-xs text-subtle">{fmtDate(c.date)}</span>
            </li>
          ))}
        </ul>
      )}
      {changes.length > 12 && <p className="mt-2 text-sm text-muted">…and {changes.length - 12} earlier changes.</p>}
    </Card>
  );
}

/** One square per day over the last 90 days, colored by stage. */
function StageTimeline({ s }: { s: NarrativeStat }) {
  const days = s.stageHistory.slice(-90);
  return (
    <div className="mt-1.5">
      <div className="flex gap-px">
        {days.map((h) => (
          <span
            key={h.date}
            title={`${fmtDate(h.date)}: ${h.stage ?? "no data"}`}
            className="h-4 flex-1 rounded-[1px]"
            style={{ background: h.stage ? STAGES[h.stage].color : "var(--surface-3)" }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-subtle">
        <span>{fmtDate(days[0].date)}</span>
        <span>
          {s.previousStage ? `${s.previousStage} → ` : ""}
          {s.stage}
        </span>
        <span>today</span>
      </div>
    </div>
  );
}

/** Where new projects and stablecoins are arriving: early signs of a sector or ecosystem growing. */
function Builders({ builders }: { builders: NarrativesResponse["builders"] }) {
  // Below this many listings in the prior 90 days, a % change is noise (often a category DefiLlama just created).
  const MIN_PRIOR = 5;
  const trend = (last: number, prev: number) => (prev >= MIN_PRIOR ? last / prev - 1 : null);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <SectionTitle title="Where builders are launching" subtitle="New protocols DefiLlama started tracking, by its categories: last 90 days vs the 90 before." />
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs font-bold text-fg">
            <tr className="border-b border-line">
              <th className="py-1.5">Category</th>
              <th className="py-1.5 text-right">Last 90d</th>
              <th className="py-1.5 text-right">Prior 90d</th>
              <th className="py-1.5 text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {builders.categories.map((c) => (
              <tr key={c.name} className="border-b border-line">
                <td className="py-1.5 text-fg">{c.name}</td>
                <td className="py-1.5 text-right font-semibold text-fg-2">{c.last90}</td>
                <td className="py-1.5 text-right text-muted">{c.prev90}</td>
                <td className="py-1.5 text-right">
                  {c.prev90 >= MIN_PRIOR ? <Pct value={trend(c.last90, c.prev90)} /> : <span className="text-xs text-subtle">new category</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card>
        <SectionTitle title="Chains: capital and builders" subtitle="Stablecoins sitting on each chain (money ready to deploy) and new protocols launched there in 90 days." />
        <table className="tabular w-full text-sm">
          <thead className="text-left text-xs font-bold text-fg">
            <tr className="border-b border-line">
              <th className="py-1.5">Chain</th>
              <th className="py-1.5 text-right">Stablecoins</th>
              <th className="py-1.5 text-right">30d</th>
              <th className="py-1.5 text-right">New protocols 90d</th>
            </tr>
          </thead>
          <tbody>
            {builders.chains.map((c) => (
              <tr key={c.name} className="border-b border-line">
                <td className="py-1.5 text-fg">{c.name}</td>
                <td className="py-1.5 text-right text-fg-2">{fmtUsd(c.stablecoins)}</td>
                <td className="py-1.5 text-right">
                  <Pct value={c.stablecoinChange30d} />
                </td>
                <td className="py-1.5 text-right text-muted">
                  {fmtNum(c.last90)}
                  {c.prev90 > 0 && <span className="ml-1 text-xs">(prior {c.prev90})</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/** What the stage check found, so stages are read as a description of fundamentals rather than a buy signal. */
function StageCheckNote() {
  const { data } = useStageCheck();
  if (!data) return null;
  const f = stageFinding(data);
  return (
    <p className="text-sm text-muted">
      <b className="text-fg">Stage check ({data.from?.slice(0, 4)}–{data.to?.slice(0, 4)}):</b> {f.text}{" "}
      <Link href="/backtest#stage-check" className="font-semibold text-brand-strong hover:underline">
        Details →
      </Link>
    </p>
  );
}
