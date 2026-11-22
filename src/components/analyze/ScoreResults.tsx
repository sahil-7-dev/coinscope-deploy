"use client";

import { Fragment, useState } from "react";
import type { ScoreResult, Status } from "@/lib/analysis/score";
import { fmtPct, fmtPrice } from "@/lib/format";
import { Badge, CoinIcon, Pct } from "@/components/ui";
import { PriceVolumeChart } from "@/components/PriceVolumeChart";
import { CoinActions } from "@/components/CoinActions";
import { MiniScores, ScoresPanel } from "@/components/ScoresPanel";
import { DriverList, MetricsGrid, RedFlagList } from "./CoinDetails";

const STATUS: Record<Status, { icon: string; cls: string }> = {
  pass: { icon: "✓", cls: "text-up" },
  fail: { icon: "✕", cls: "text-down" },
  unknown: { icon: "?", cls: "text-subtle" },
};

function scoreColor(score: number) {
  return score >= 75 ? "bg-up" : score >= 50 ? "bg-warn" : "bg-down";
}

export function ScoreResults({ results }: { results: ScoreResult[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const sorted = [...results].sort((a, b) => b.score * b.coverage - a.score * a.coverage);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="py-2">Coin</th>
            <th className="py-2">Match score</th>
            <th className="py-2">Verdict</th>
            <th className="py-2 text-right" title="Share of checklist weight that had data">
              Data coverage
            </th>
            <th className="py-2 text-right">30d</th>
            <th className="py-2 pl-3">S / M / L / Risk</th>
            <th className="py-2 text-right">Red flags</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody className="tabular">
          {sorted.map((r) => {
            const p = r.profile;
            const isOpen = open === p.id;
            const passed = r.criteria.filter((c) => c.status === "pass").length;
            return (
              <Fragment key={p.id}>
                <tr className="cursor-pointer border-b border-line hover:bg-surface-2" onClick={() => setOpen(isOpen ? null : p.id)}>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <CoinIcon src={p.image} alt={p.name} />
                      <span className="text-fg">{p.name}</span>
                      <span className="text-subtle">{p.symbol}</span>
                      <span className="text-xs text-subtle">{fmtPrice(p.price)}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-28 overflow-hidden rounded-full bg-surface-3">
                        <div className={`h-full ${scoreColor(r.score)}`} style={{ width: `${r.score}%` }} />
                      </div>
                      <span className="w-9 font-semibold text-fg">{r.score}</span>
                      <span className="text-xs text-subtle">
                        {passed}/{r.criteria.length}
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge tone={r.verdict.tone}>{r.verdict.label}</Badge>
                  </td>
                  <td className="py-2.5 text-right text-muted">{fmtPct(r.coverage, { signed: false })}</td>
                  <td className="py-2.5 text-right">
                    <Pct value={p.change.d30} />
                  </td>
                  <td className="py-2.5 pl-3">
                    <MiniScores scores={p.scores} />
                  </td>
                  <td className="py-2.5 text-right">
                    {p.redFlags.length ? (
                      <span className={p.redFlags.some((f) => f.severity === "high") ? "text-down" : "text-warn"}>{p.redFlags.length}</span>
                    ) : (
                      <span className="text-faint">0</span>
                    )}
                  </td>
                  <td className="py-2.5 pl-2 text-right text-subtle">{isOpen ? "▲" : "▼"}</td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-line">
                    <td colSpan={8} className="bg-surface-2 px-2 py-4">
                      <ScoreDetail r={r} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScoreDetail({ r }: { r: ScoreResult }) {
  const p = r.profile;
  return (
    <div className="space-y-5">
      <CoinActions p={p} />
      <ScoresPanel scores={p.scores} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-2 text-base font-bold text-fg">Checklist</h4>
          <ul className="space-y-1.5">
            {r.criteria.map((c) => (
              <li key={c.item.id} className="flex items-baseline gap-2 text-sm">
                <span className={`w-4 font-bold ${STATUS[c.status].cls}`}>{STATUS[c.status].icon}</span>
                <span className="text-fg">{c.label}</span>
                <span className="text-xs text-faint">w{c.item.weight}</span>
                <span className="ml-auto text-right text-fg-2">
                  {c.display} <span className="text-xs text-subtle">(target {c.target})</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-base font-bold text-fg">Red flags</h4>
            <RedFlagList flags={p.redFlags} />
          </div>
          <div>
            <h4 className="mb-2 text-base font-bold text-fg">What&apos;s moving it now</h4>
            <DriverList drivers={p.drivers.filter((d) => d.kind !== "catalyst")} />
          </div>
        </div>
      </div>
      <PriceVolumeChart series={p.series} rally={p.rally} height={180} />
      <MetricsGrid p={p} showSetup={false} />
    </div>
  );
}
