"use client";

import { useState } from "react";
import type { BacktestResponse, BacktestStats, Checklist, PickedCoin } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtPct } from "@/lib/format";
import { Button, ErrorBox, Pct, Spinner } from "@/components/ui";

const HORIZONS = [14, 30, 60];
const THRESHOLDS = [60, 75, 90];
const TOP_N = [0, 20, 40];

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

function StatBlock({ title, s, tone }: { title: string; s: BacktestStats; tone: string }) {
  const rows: [string, React.ReactNode][] = [
    ["Average return", <Pct key="a" value={s.avgReturn} />],
    ["Median return", <Pct key="m" value={s.medianReturn} />],
    ["Win rate (> 0%)", fmtPct(s.winRate, { signed: false, digits: 0 })],
    ["Beat BTC", fmtPct(s.beatBenchmarkRate, { signed: false, digits: 0 })],
  ];
  return (
    <div className={`rounded-xl border p-3 ${tone}`}>
      <div className="text-sm font-semibold text-fg">{title}</div>
      <div className="mb-2 text-xs text-subtle">{s.count} data points</div>
      <table className="tabular w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-0.5 text-muted">{k}</td>
              <td className="py-0.5 text-right text-fg">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BacktestPanel({ checklist, coins }: { checklist: Checklist; coins: PickedCoin[] }) {
  const [horizon, setHorizon] = useState(30);
  const [threshold, setThreshold] = useState(75);
  const [topN, setTopN] = useState(20);
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<BacktestResponse>("/api/backtest", {
          body: {
            checklist,
            ids: coins.map((c) => c.id),
            names: Object.fromEntries(coins.map((c) => [c.id, c.name])),
            topN,
            horizonDays: horizon,
            threshold,
          },
        }),
      );
    } catch (err) {
      setError(errMsg(err, "Backtest failed"));
    } finally {
      setBusy(false);
    }
  };

  const edge = result && result.stats.avgReturn !== null && result.baseline.avgReturn !== null ? result.stats.avgReturn - result.baseline.avgReturn : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Select label="Hold for" value={horizon} options={HORIZONS} onChange={setHorizon} fmt={(v) => `${v} days`} />
        <Select label="Signal when score ≥" value={threshold} options={THRESHOLDS} onChange={setThreshold} fmt={(v) => `${v}`} />
        <Select label="Also test top" value={topN} options={TOP_N} onChange={setTopN} fmt={(v) => (v ? `${v} coins` : "none")} />
        <Button onClick={run} disabled={busy}>
          {busy ? "Running…" : "Run backtest"}
        </Button>
      </div>
      <p className="text-sm text-subtle">
        Replays the past year every 2 days for your winners, candidates{topN ? ` and the top ${topN} coins` : ""}: on each day the checklist&apos;s chart-based
        criteria are scored, and when the score clears the bar it records what the price did over the next {horizon} days. That&apos;s compared with buying on
        any day. Fundamentals, supply and listings only exist for today, so they&apos;re left out.
      </p>

      {busy && <Spinner label="Loading a year of prices per coin (cached after the first run, so later runs are fast)…" />}
      {error && <ErrorBox message={error} />}

      {result && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <StatBlock title="When the checklist fired" s={result.stats} tone="border-up/40 bg-up/5" />
            <StatBlock title="Baseline: any day" s={result.baseline} tone="border-line" />
            <div className="rounded-xl border border-line p-3 text-sm">
              <div className="font-semibold text-fg">Verdict</div>
              {result.stats.count < 10 ? (
                <p className="mt-1 text-muted">Only {result.stats.count} signals, too few to trust. Loosen targets, lower the threshold, or test more coins.</p>
              ) : edge !== null ? (
                <p className="mt-1 text-fg-2">
                  Signals averaged <Pct value={edge} /> {edge >= 0 ? "more" : "less"} than buying at random over {result.horizonDays} days
                  {edge >= 0.02 ? ": the checklist has had a real edge." : edge > -0.02 ? ": no clear edge." : ": it has picked worse than random."}
                </p>
              ) : null}
              <p className="mt-2 text-sm text-subtle">
                Tested {result.coinsTested.length} coins on: {result.criteriaUsed.join(", ") || "nothing"}.
                {result.criteriaSkipped.length > 0 && ` Skipped (no history): ${result.criteriaSkipped.join(", ")}.`}
              </p>
            </div>
          </div>

          {result.signals.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-xl border border-line">
              <table className="tabular w-full text-sm">
                <thead className="sticky top-0 bg-surface text-left whitespace-nowrap text-xs font-bold text-fg">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Coin</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2 text-right">Next {result.horizonDays}d</th>
                    <th className="px-3 py-2 text-right">BTC same period</th>
                  </tr>
                </thead>
                <tbody>
                  {result.signals.map((s) => (
                    <tr key={`${s.coinId}-${s.date}`} className="border-t border-line">
                      <td className="px-3 py-1.5 text-muted">{fmtDate(s.date)}</td>
                      <td className="px-3 py-1.5 text-fg">{s.coinName}</td>
                      <td className="px-3 py-1.5 text-right text-muted">{s.score}</td>
                      <td className="px-3 py-1.5 text-right">
                        <Pct value={s.forwardReturn} />
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <Pct value={s.benchmarkReturn} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.errors.length > 0 && <p className="text-sm text-subtle">Skipped: {result.errors.map((e) => `${e.id} (${e.message})`).join(", ")}</p>}
        </div>
      )}
    </div>
  );
}
