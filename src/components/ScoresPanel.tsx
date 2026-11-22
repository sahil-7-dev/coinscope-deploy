"use client";

import { useState } from "react";
import type { HorizonScore, InvestmentScores } from "@/lib/types";
import { fmtPct } from "@/lib/format";
import { Badge } from "./ui";

export const HORIZONS = [
  { key: "short", icon: "⚡", title: "Short-term", sub: "technical, days – 2 weeks" },
  { key: "mid", icon: "📈", title: "Fundamentals", sub: "mid-term, no TA" },
  { key: "long", icon: "🏛", title: "Long-term", sub: "1 year +" },
  { key: "risk", icon: "⚠", title: "Risk", sub: "higher = riskier" },
] as const;

export type HorizonKey = (typeof HORIZONS)[number]["key"];

export function scoreBarColor(score: number | null, risk = false): string {
  if (score === null) return "bg-surface-3";
  const s = risk ? 100 - score : score;
  return s >= 70 ? "bg-up" : s >= 55 ? "bg-up/70" : s >= 40 ? "bg-warn" : "bg-down";
}

export function ScoreBar({ score, risk = false, width = "w-full" }: { score: number | null; risk?: boolean; width?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-surface-3 ${width}`}>
      <div className={`h-full ${scoreBarColor(score, risk)}`} style={{ width: `${score ?? 0}%` }} />
    </div>
  );
}

/** Compact S/M/L/Risk chips for tables. */
export function MiniScores({ scores }: { scores: InvestmentScores }) {
  return (
    <span className="tabular inline-flex gap-1.5 text-xs">
      {HORIZONS.map((h) => {
        const s = scores[h.key];
        return (
          <span key={h.key} title={`${h.title}: ${s.label}`} className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5">
            <span className="text-subtle">{h.key === "risk" ? "R" : h.key[0].toUpperCase()}</span>
            <span className={s.score === null ? "text-subtle" : h.key === "risk" ? riskText(s.score) : oppText(s.score)}>{s.score ?? "–"}</span>
          </span>
        );
      })}
    </span>
  );
}

const oppText = (s: number) => (s >= 55 ? "text-up" : s >= 40 ? "text-warn" : "text-down");
const riskText = (s: number) => (s < 30 ? "text-up" : s < 50 ? "text-fg-2" : s < 70 ? "text-warn" : "text-down");

export function ScoresPanel({ scores }: { scores: InvestmentScores }) {
  const [open, setOpen] = useState<HorizonKey | null>(null);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {HORIZONS.map((h) => {
          const s = scores[h.key];
          const active = open === h.key;
          return (
            <button
              key={h.key}
              type="button"
              onClick={() => setOpen(active ? null : h.key)}
              className={`rounded-xl border p-3 text-left transition ${active ? "border-brand bg-surface-3" : "border-line bg-surface hover:border-line-strong"}`}
            >
              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {h.icon} {h.title}
                </span>
                <span className="text-faint">{h.sub}</span>
              </div>
              <div className="mt-1 flex items-end justify-between">
                <span className="tabular text-3xl font-semibold text-fg">
                  {s.score ?? "–"}
                  <span className="text-sm text-subtle">/100</span>
                </span>
                <Badge tone={s.tone}>{s.label}</Badge>
              </div>
              <div className="mt-2">
                <ScoreBar score={s.score} risk={h.key === "risk"} />
              </div>
              <div className="mt-1.5 text-xs text-subtle">
                Data coverage {fmtPct(s.coverage, { signed: false, digits: 0 })} · {active ? "hide factors ▲" : "show factors ▼"}
              </div>
            </button>
          );
        })}
      </div>
      {open && <FactorTable score={scores[open]} risk={open === "risk"} />}
    </div>
  );
}

function FactorTable({ score, risk }: { score: HorizonScore; risk: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-surface-2 text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr>
            <th className="px-3 py-2">Factor</th>
            <th className="px-3 py-2 text-right">Value</th>
            <th className="px-3 py-2">{risk ? "Risk" : "Score"}</th>
            <th className="px-3 py-2 text-right">Weight</th>
            <th className="px-3 py-2">Why it matters</th>
          </tr>
        </thead>
        <tbody>
          {score.factors.map((f) => (
            <tr key={f.name} className={`border-t border-line ${f.score === null ? "opacity-50" : ""}`}>
              <td className="px-3 py-2 text-fg">{f.name}</td>
              <td className="tabular px-3 py-2 text-right text-fg-2">{f.display}</td>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <ScoreBar score={f.score} risk={risk} width="w-20" />
                  <span className="tabular w-7 text-xs text-muted">{f.score ?? "–"}</span>
                </div>
              </td>
              <td className="tabular px-3 py-2 text-right text-subtle">{f.weight}</td>
              <td className="px-3 py-2 text-xs text-subtle">{f.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
