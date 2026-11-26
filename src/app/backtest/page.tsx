"use client";

import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { StrategyBacktestResult, StrategyOptions, StrategyStats, StrategyValidation, Tone, ValidationRun } from "@/lib/types";
import type { Job } from "@/lib/server/jobs";
import { api, errMsg } from "@/lib/api";
import { useChartColors } from "@/lib/theme";
import { fmtDate, fmtPct } from "@/lib/format";
import { Badge, Button, Card, ErrorBox, PageHeader, Pct, SectionTitle, Spinner } from "@/components/ui";
import { StageCheck } from "@/components/StageCheck";

const HORIZONS = [30, 60, 90];
const THRESHOLDS = [50, 55, 60, 65, 70];
const COSTS = [0.0025, 0.005, 0.01];
const UNIVERSES = [150, 300, 0];

function Select<T extends number>({ label, value, options, onChange, fmt }: { label: string; value: T; options: T[]; onChange: (v: T) => void; fmt: (v: T) => string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <select value={value} onChange={(e) => onChange(Number(e.target.value) as T)} className="rounded border border-line bg-surface px-2 py-1 text-fg">
        {options.map((o) => (
          <option key={o} value={o}>
            {fmt(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

const pctAbs = (v: number | null) => fmtPct(v, { signed: false, digits: 0 });

export default function BacktestPage() {
  const [opts, setOpts] = useState<StrategyOptions>({ horizonDays: 60, threshold: 60, cost: 0.005, maxCoins: 300 });
  const [result, setResult] = useState<StrategyBacktestResult | null>(null);
  const [job, setJob] = useState<Job<StrategyBacktestResult> | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ latest: StrategyBacktestResult | null }>("/api/strategy-backtest")
      .then((r) => {
        if (cancelled || !r.latest) return;
        setResult(r.latest);
        setOpts(r.latest.options);
      })
      .catch((err) => !cancelled && setError(errMsg(err, "Couldn't load the last backtest")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // While a job runs, poll it until it finishes.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick(id: string) {
      try {
        const j = await api<Job<StrategyBacktestResult>>(`/api/strategy-backtest?id=${encodeURIComponent(id)}`);
        if (cancelled) return;
        if (j.status === "running") {
          setJob(j);
          timer = setTimeout(() => tick(id), 1500);
          return;
        }
        if (j.status === "done" && j.result) setResult(j.result);
        else setError(j.error ?? "Backtest failed");
        setJob(null);
        setJobId(null);
      } catch (err) {
        if (cancelled) return;
        setError(errMsg(err, "Lost track of the backtest"));
        setJob(null);
        setJobId(null);
      }
    }
    tick(jobId);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  const run = async () => {
    setError(null);
    try {
      const { id } = await api<{ id: string }>("/api/strategy-backtest", { body: opts });
      setJob({ id, kind: "strategy-backtest", status: "running", progress: { stage: "Starting", done: 0, total: 0 }, startedAt: new Date().toISOString() });
      setJobId(id);
    } catch (err) {
      setError(errMsg(err, "Couldn't start the backtest"));
    }
  };

  const running = job !== null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Backtest"
        subtitle="Does the fundamental score actually work? It's replayed every 3 days since 2021 on hundreds of coins, including coins Binance later delisted, using only data known on each day, and checked against what happened next, after trading costs. No technical analysis."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-4">
          <Select label="Hold for" value={opts.horizonDays} options={HORIZONS} onChange={(v) => setOpts({ ...opts, horizonDays: v })} fmt={(v) => `${v} days`} />
          <Select label="Buy when score ≥" value={opts.threshold} options={THRESHOLDS} onChange={(v) => setOpts({ ...opts, threshold: v })} fmt={(v) => `${v}`} />
          <Select label="Trading cost" value={opts.cost} options={COSTS} onChange={(v) => setOpts({ ...opts, cost: v })} fmt={(v) => `${(v * 100).toFixed(2)}% round trip`} />
          <Select
            label="Coins"
            value={opts.maxCoins}
            options={UNIVERSES}
            onChange={(v) => setOpts({ ...opts, maxCoins: v })}
            fmt={(v) => (v ? `Top ${v} by volume + delisted` : "All Binance coins + delisted")}
          />
          <Button onClick={run} disabled={running || loading}>
            {running ? "Running…" : "Run backtest"}
          </Button>
        </div>
        <p className="mt-3 text-sm text-subtle">
          The first run downloads years of daily prices for every coin and fee history from DefiLlama (a few minutes). Prices are stored locally, so runs
          later the same day take seconds.
        </p>
        {job && <Progress job={job} />}
      </Card>

      {error && <ErrorBox message={error} />}
      {loading && <Spinner label="Loading the last result…" />}
      {!loading && !result && !running && <p className="text-sm text-muted">No backtest yet. Pick the settings above and run one.</p>}
      {result && <Results r={result} />}
      <StageCheck />
    </div>
  );
}

function Progress({ job }: { job: Job<StrategyBacktestResult> }) {
  const { stage, done, total } = job.progress;
  return (
    <div className="mt-4 space-y-1.5">
      <div className="flex justify-between text-sm text-muted">
        <span>{stage}…</span>
        {total > 0 && (
          <span className="tabular">
            {done} / {total}
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div className={`h-full bg-brand transition-all ${total ? "" : "animate-pulse"}`} style={{ width: total ? `${(done / total) * 100}%` : "100%" }} />
      </div>
    </div>
  );
}

// ---- Results ----

function verdictOf(r: StrategyBacktestResult): { tone: Tone; label: string; text: string } {
  const { avg, low, high } = r.edge;
  const h = r.options.horizonDays;
  if (r.signals.count < 30 || avg === null) {
    return { tone: "neutral", label: "Too few signals", text: `Only ${r.signals.count} signals. Lower the threshold or include more coins.` };
  }
  const range = low !== null && high !== null ? ` (90% range ${fmtPct(low)} to ${fmtPct(high)})` : "";
  if (low !== null && low > 0) {
    return { tone: "good", label: "Real edge", text: `Coins scoring ${r.options.threshold}+ beat the average coin by ${fmtPct(avg)} per ${h}-day hold${range}, after costs.` };
  }
  if (high !== null && high < 0) {
    return { tone: "bad", label: "Worse than random", text: `Coins scoring ${r.options.threshold}+ did ${fmtPct(avg)} worse than the average coin per ${h}-day hold${range}.` };
  }
  return {
    tone: "warn",
    label: "Can't tell from luck",
    text: `Signals averaged ${fmtPct(avg)} vs the average coin per ${h}-day hold, but the 90% range (${fmtPct(low)} to ${fmtPct(high)}) includes zero, so this could be luck.`,
  };
}

/** Do higher score buckets earn more? Only buckets with enough data count. */
function monotonic(r: StrategyBacktestResult): string | null {
  const b = r.buckets.filter((x) => x.stats.count >= 200 && x.stats.avgReturn !== null);
  if (b.length < 3) return null;
  const ups = b.slice(1).filter((x, i) => (x.stats.avgReturn as number) > (b[i].stats.avgReturn as number)).length;
  if (ups === b.length - 1) return "Higher scores were followed by higher returns at every step: the score ranks coins the right way.";
  if (ups === 0) return "Higher scores were followed by lower returns: the score ranks coins the wrong way.";
  return `Higher scores did better in ${ups} of ${b.length - 1} steps: the ranking is only partly right.`;
}

function Results({ r }: { r: StrategyBacktestResult }) {
  const v = verdictOf(r);
  const mono = monotonic(r);
  const h = r.options.horizonDays;
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone={v.tone}>{v.label}</Badge>
          <span className="text-sm text-subtle">
            {fmtDate(r.period.from)} {r.period.from.slice(0, 4)} – {fmtDate(r.period.to)} {r.period.to.slice(0, 4)} · {r.coins.tested} coins ({r.coins.delisted} later
            delisted) · run {new Date(r.ranAt).toLocaleString()} in {Math.round(r.durationMs / 1000)}s
          </span>
        </div>
        <p className="mt-3 text-base text-fg">{v.text}</p>
        {mono && <p className="mt-1 text-base text-fg-2">{mono}</p>}
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <StatBlock title={`Score ≥ ${r.options.threshold} (one hold at a time per coin)`} s={r.signals} h={h} accent />
          <StatBlock title="Baseline: every coin, every 3 days" s={r.baseline} h={h} />
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Return by score" subtitle={`Average ${h}-day return after costs, by fundamental score. A working score climbs left to right.`} />
          <BucketChart r={r} />
          <StatsTable rows={r.buckets.map((b) => ({ label: `Score ${b.label}`, s: b.stats }))} />
        </Card>
        <Card>
          <SectionTitle title="Which factors predicted returns" subtitle="Each day, coins are ranked by the factor and by what they did next; this is the average correlation of the two rankings." />
          <FactorTable r={r} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Bull vs bear markets" subtitle="Bull = BTC above its 200-day average on the day of the signal." />
          <PairTable rows={r.regimes.map((x) => ({ label: x.regime, signals: x.signals, baseline: x.baseline }))} />
        </Card>
        <Card>
          <SectionTitle title="Year by year" subtitle="A real edge should show up in most years, not just one." />
          <PairTable rows={r.years.map((x) => ({ label: x.year, signals: x.signals, baseline: x.baseline }))} />
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title="Do early narratives pay?"
            subtitle={`Every coin-day by the fundamentals-only stage of the coin's strongest narrative that day. Average ${h}-day return after costs.`}
          />
          <StatsTable rows={r.phases.map((p) => ({ label: p.phase, s: p.stats }))} />
          {r.attention && (
            <>
              <h3 className="mt-5 mb-2 text-sm font-bold text-fg">Market attention (context, never scored)</h3>
              <StatsTable rows={r.attention.map((a) => ({ label: a.label, s: a.stats }))} />
            </>
          )}
        </Card>
        <Card>
          <SectionTitle title="Fundamentals vs none" subtitle="Coins with fees tracked on DefiLlama that day vs coins without." />
          <StatsTable rows={r.fa.map((p) => ({ label: p.label, s: p.stats }))} />
          <p className="mt-3 text-sm text-subtle">
            Delisted coins: {r.delisted.coins} coins, {r.delisted.observations.toLocaleString()} coin-days, averaging <Pct value={r.delisted.avgReturn} /> per hold.
            Leaving them out would have made every number above look better.
          </p>
        </Card>
      </div>

      {r.validation && <Robustness v={r.validation} />}

      <Card>
        <SectionTitle title="What was tested, and the limits" />
        <ul className="space-y-1.5 text-sm text-fg-2">
          <li>
            • Replayed {fmtPct(r.backtestedWeight, { signed: false, digits: 0 })} of the scorecard&apos;s weight: {r.factorsUsed.join(", ")}.
          </li>
          <li>• Left out (need data that only exists for today, or your own ratings): {r.factorsSkipped.join(", ")}.</li>
          <li>
            • {r.coins.withFees} coins had fee data at some point, {r.coins.withNarrative} belonged to a tracked narrative.
          </li>
          {r.notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      </Card>

      {r.recentSignals.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="p-4 pb-2">
            <SectionTitle title="Most recent signals" subtitle={`The last ${r.recentSignals.length} times a coin scored ${r.options.threshold}+, and its next ${h} days.`} />
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="tabular w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left whitespace-nowrap text-xs font-bold text-fg">
                <tr className="border-b border-line">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-3 py-2">Coin</th>
                  <th className="px-3 py-2 text-right">Score</th>
                  <th className="px-3 py-2 text-right">Next {h}d (net)</th>
                  <th className="px-3 py-2 text-right">BTC</th>
                </tr>
              </thead>
              <tbody>
                {r.recentSignals.map((s) => (
                  <tr key={`${s.symbol}-${s.date}`} className="border-b border-line">
                    <td className="px-4 py-1.5 text-muted">
                      {fmtDate(s.date)} {s.date.slice(0, 4)}
                    </td>
                    <td className="px-3 py-1.5 text-fg">
                      {s.symbol}
                      {s.delistedExit && <span className="ml-1.5 text-xs text-down">delisted</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted">{s.score}</td>
                    <td className="px-3 py-1.5 text-right">
                      <Pct value={s.ret} />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Pct value={s.btc} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function StatBlock({ title, s, h, accent = false }: { title: string; s: StrategyStats; h: number; accent?: boolean }) {
  const rows: [string, React.ReactNode][] = [
    [`Average ${h}-day return`, <Pct key="a" value={s.avgReturn} />],
    ["Median return", <Pct key="m" value={s.medianReturn} />],
    ["Win rate (> 0%)", pctAbs(s.winRate)],
    ["Beat BTC", pctAbs(s.beatBtcRate)],
  ];
  return (
    <div className={`rounded-xl border p-3 ${accent ? "border-up/40 bg-up/5" : "border-line"}`}>
      <div className="text-sm font-semibold text-fg">{title}</div>
      <div className="mb-2 text-xs text-subtle">{s.count.toLocaleString()} holds</div>
      <table className="tabular w-full text-sm">
        <tbody>
          {rows.map(([k, val]) => (
            <tr key={k}>
              <td className="py-0.5 text-muted">{k}</td>
              <td className="py-0.5 text-right text-fg">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatsTable({ rows }: { rows: { label: string; s: StrategyStats }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[480px] text-sm">
        <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="py-2 pr-3">Group</th>
            <th className="px-2 py-2 text-right">Coin-days</th>
            <th className="px-2 py-2 text-right">Average</th>
            <th className="px-2 py-2 text-right">Median</th>
            <th className="px-2 py-2 text-right">Win rate</th>
            <th className="py-2 pl-2 text-right">Beat BTC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, s }) => (
            <tr key={label} className={`border-b border-line ${s.count < 100 ? "opacity-60" : ""}`}>
              <td className="py-1.5 pr-3 text-fg">{label}</td>
              <td className="px-2 py-1.5 text-right text-muted">{s.count.toLocaleString()}</td>
              <td className="px-2 py-1.5 text-right font-semibold">
                <Pct value={s.avgReturn} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <Pct value={s.medianReturn} />
              </td>
              <td className="px-2 py-1.5 text-right text-muted">{pctAbs(s.winRate)}</td>
              <td className="py-1.5 pl-2 text-right text-muted">{pctAbs(s.beatBtcRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PairTable({ rows }: { rows: { label: string; signals: StrategyStats; baseline: StrategyStats }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[420px] text-sm">
        <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="py-2 pr-3">Period</th>
            <th className="px-2 py-2 text-right">Signals</th>
            <th className="px-2 py-2 text-right">Signal avg</th>
            <th className="px-2 py-2 text-right">Baseline avg</th>
            <th className="py-2 pl-2 text-right">Edge</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, signals, baseline }) => {
            const edge = signals.avgReturn !== null && baseline.avgReturn !== null ? signals.avgReturn - baseline.avgReturn : null;
            return (
              <tr key={label} className={`border-b border-line ${signals.count < 10 ? "opacity-60" : ""}`}>
                <td className="py-1.5 pr-3 text-fg">{label}</td>
                <td className="px-2 py-1.5 text-right text-muted">{signals.count}</td>
                <td className="px-2 py-1.5 text-right">
                  <Pct value={signals.avgReturn} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Pct value={baseline.avgReturn} />
                </td>
                <td className="py-1.5 pl-2 text-right font-semibold">
                  <Pct value={edge} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-subtle">Faded rows have fewer than 10 signals.</p>
    </div>
  );
}

function FactorTable({ r }: { r: StrategyBacktestResult }) {
  const verdict = (ic: number | null) =>
    ic === null ? { tone: "neutral" as Tone, label: "No data" } : ic >= 0.03 ? { tone: "good" as Tone, label: "Helps" } : ic <= -0.03 ? { tone: "bad" as Tone, label: "Hurts" } : { tone: "neutral" as Tone, label: "No real effect" };
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[440px] text-sm">
        <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="py-2 pr-3">Factor</th>
            <th className="px-2 py-2 text-right">Correlation</th>
            <th className="px-2 py-2 text-right" title="Share of days the correlation was positive">
              Right on
            </th>
            <th className="py-2 pl-2">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {r.factors.map((f) => {
            const v = verdict(f.ic);
            return (
              <tr key={f.key} className={`border-b border-line ${f.key === "score" ? "font-semibold" : ""}`}>
                <td className="py-1.5 pr-3 text-fg">{f.label}</td>
                <td className="px-2 py-1.5 text-right text-fg-2">{f.ic === null ? "—" : f.ic.toFixed(3)}</td>
                <td className="px-2 py-1.5 text-right text-muted">{f.positiveShare === null ? "—" : `${pctAbs(f.positiveShare)} of ${f.dates} days`}</td>
                <td className="py-1.5 pl-2">
                  <Badge tone={v.tone}>{v.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-subtle">
        In markets, a steady correlation of 0.03–0.05 is already useful; above 0.1 is rare. Below ±0.03 is indistinguishable from noise.
      </p>
    </div>
  );
}

function BucketChart({ r }: { r: StrategyBacktestResult }) {
  const c = useChartColors();
  const data = r.buckets.map((b) => ({ label: b.label, avg: b.stats.avgReturn === null ? null : b.stats.avgReturn * 100, count: b.stats.count }));
  return (
    <div className="mb-3 h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={c.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: c.axis, fontSize: 11 }} />
          <YAxis tick={{ fill: c.axis, fontSize: 11 }} unit="%" width={48} />
          <ReferenceLine y={0} stroke={c.cursor} />
          <Tooltip
            cursor={{ fill: c.grid, opacity: 0.4 }}
            content={({ active, payload }) => {
              const p = active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null;
              return p ? (
                <div className="rounded border border-line bg-surface px-2 py-1 text-xs">
                  <div className="text-fg">Score {p.label}</div>
                  <div className="text-muted">
                    {p.avg === null ? "No data" : `${p.avg >= 0 ? "+" : ""}${p.avg.toFixed(1)}% average`} · {p.count.toLocaleString()} coin-days
                  </div>
                </div>
              ) : null;
            }}
          />
          <Bar dataKey="avg" radius={[4, 4, 4, 4]} maxBarSize={44} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={(d.avg ?? 0) >= 0 ? "var(--up)" : "var(--down)"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---- Robustness: periods, weights, stage orderings ----

const icText = (v: number | null) => (v === null ? "—" : v.toFixed(3));

function robustnessVerdict(v: StrategyValidation): { tone: Tone; text: string } {
  const tested = v.periods.filter((p) => p.ic !== null && p.signals.count >= 30);
  const allPositive = tested.length >= 2 && tested.every((p) => (p.ic as number) > 0.03 && (p.edge ?? 0) > 0);
  const weightsHold = (v.randomWeights.positiveEdgeShare ?? 0) >= 0.9;
  if (allPositive && weightsHold) {
    return { tone: "good", text: "Holds up: the score ranked coins well in both periods, and the edge stayed positive across random weight changes." };
  }
  if (!allPositive) return { tone: "warn", text: "Inconsistent: the score didn't work in every period, so the overall result may lean on one stretch of history." };
  return { tone: "warn", text: "Fragile: the edge depends on the exact weights." };
}

function RunTable({ rows, first }: { rows: (ValidationRun & { from?: string; to?: string })[]; first: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[520px] text-sm">
        <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="py-1.5 pr-3">{first}</th>
            <th className="px-2 py-1.5 text-right" title="Average daily rank correlation between the score and what happened next">
              Correlation
            </th>
            <th className="px-2 py-1.5 text-right">Right on</th>
            <th className="px-2 py-1.5 text-right">Signals</th>
            <th className="py-1.5 pl-2 text-right">Edge vs all coins</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className={`border-b border-line ${r.signals.count < 30 ? "opacity-60" : ""}`}>
              <td className="py-1.5 pr-3 text-fg">
                {r.label}
                {r.from !== undefined && <div className="text-xs text-subtle">{r.from ? `${r.from} → ${r.to}` : "no data yet"}</div>}
              </td>
              <td className="px-2 py-1.5 text-right font-semibold text-fg-2">{icText(r.ic)}</td>
              <td className="px-2 py-1.5 text-right text-muted">{fmtPct(r.positiveShare, { signed: false, digits: 0 })}</td>
              <td className="px-2 py-1.5 text-right text-muted">{r.signals.count}</td>
              <td className="py-1.5 pl-2 text-right">
                <Pct value={r.edge} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Does the scorecard know more than "older coins do better"? */
function baselineVerdict(v: StrategyValidation): { tone: Tone; text: string } | null {
  const score = v.baselines?.[0];
  const age = v.baselines?.find((b) => b.label.startsWith("Age only"));
  const beyond = v.beyondAge?.ic ?? null;
  if (!score || !age || score.ic === null || age.ic === null || beyond === null) return null;
  if (beyond >= 0.03 && score.ic > age.ic) {
    return { tone: "good", text: `The score beats age alone (${icText(score.ic)} vs ${icText(age.ic)}) and still ranks coins with age held constant (${icText(beyond)}): the fundamentals add something.` };
  }
  if (beyond > 0) {
    return { tone: "warn", text: `Mostly age: with age held constant the score's correlation is only ${icText(beyond)}. The fundamentals add little beyond "older coins do better" so far.` };
  }
  return { tone: "bad", text: `Age explains it: with age held constant the score's correlation is ${icText(beyond)}. The fundamentals don't add anything beyond coin age here.` };
}

function Robustness({ v }: { v: StrategyValidation }) {
  const verdict = robustnessVerdict(v);
  const rw = v.randomWeights;
  const biggest = [...v.leaveOneOut].sort((a, b) => (a.ic ?? 1) - (b.ic ?? 1))[0];
  const vsBaselines = baselineVerdict(v);
  return (
    <Card>
      <SectionTitle title="Robustness" subtitle="Is the result real, or a product of one period, the exact weights, or tuning on this data?" />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verdict.tone}>{verdict.tone === "good" ? "Holds up" : "Caution"}</Badge>
        <span className="text-sm text-fg">{verdict.text}</span>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        {v.baselines && (
          <div className="lg:col-span-2">
            <h3 className="mb-1 text-sm font-bold text-fg">Against simpler rules</h3>
            <p className="mb-2 text-xs text-subtle">
              Track record (coin age) is the strongest single factor, and young tokens are known to underperform. If &quot;just pick older coins&quot; does as well as the
              score, the fundamentals aren&apos;t adding anything yet. Each rule picks the same share of coin-days as the score ({fmtPct(v.pickShare ?? null, { signed: false, digits: 0 })}
              ), except fees yes/no, which can only pick every coin with fees or none.
            </p>
            {vsBaselines && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={vsBaselines.tone}>{vsBaselines.tone === "good" ? "Adds to age" : vsBaselines.tone === "warn" ? "Mostly age" : "Just age"}</Badge>
                <span className="text-sm text-fg">{vsBaselines.text}</span>
              </div>
            )}
            <RunTable rows={v.baselines} first="Rule" />
            {v.beyondAge && (
              <p className="mt-2 text-sm text-fg-2">
                Score with age held constant: correlation <b>{icText(v.beyondAge.ic)}</b>, right on {fmtPct(v.beyondAge.positiveShare, { signed: false, digits: 0 })} of days.
              </p>
            )}
          </div>
        )}
        <div>
          <h3 className="mb-1 text-sm font-bold text-fg">By period</h3>
          <p className="mb-2 text-xs text-subtle">
            The rules were last changed on {fmtDate(v.frozenAt)} {v.frozenAt.slice(0, 4)}. Data after that date is the only truly unseen test; it fills in as time passes.
          </p>
          <RunTable rows={v.periods} first="Period" />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-bold text-fg">Narrative stage ordering</h3>
          <p className="mb-2 text-xs text-subtle">The stage ranking was adjusted on this data. If the original order scores about the same, that tuning isn&apos;t what drives the result.</p>
          <RunTable rows={v.stageVariants} first="Ordering" />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-bold text-fg">Weights</h3>
          <p className="mb-2 text-sm text-fg-2">
            Over {rw.runs} random weight sets (each weight 0.5–1.5×): correlation {icText(rw.icMin)} to {icText(rw.icMax)} (median {icText(rw.icMedian)}), edge{" "}
            <Pct value={rw.edgeMin} /> to <Pct value={rw.edgeMax} />, positive in {fmtPct(rw.positiveEdgeShare, { signed: false, digits: 0 })} of runs.
          </p>
          {biggest && (
            <p className="mb-2 text-sm text-fg-2">
              Biggest single contributor: <b>{biggest.label.replace("Without ", "")}</b> (correlation falls to {icText(biggest.ic)} without it). Categories whose removal
              barely moves the correlation add little on top of the others here, often because few coins have their data.
            </p>
          )}
          <RunTable rows={v.leaveOneOut} first="Category removed" />
        </div>
      </div>
    </Card>
  );
}
