"use client";

import { useState } from "react";
import type { Assumption, AssumptionCheck, CheckMetric, CoinProfile, CoinResearch, EvidenceStatus, EvidenceTag, NarrativeStage, Thesis, ThesisEvent, Tone } from "@/lib/types";
import { CHECK_METRICS, checkAssumption, type AssumptionStatus } from "@/lib/analysis/thesis";
import { fmtDate } from "@/lib/format";
import { Badge } from "./ui";

const STAGES: NarrativeStage[] = ["Emerging", "Accelerating", "Quiet", "Maturing", "Fading"];
const STATUS: Record<AssumptionStatus, { label: string; tone: Tone }> = {
  holds: { label: "Holds", tone: "good" },
  broken: { label: "Broken", tone: "bad" },
  "no data": { label: "No data", tone: "neutral" },
  unchecked: { label: "No data check", tone: "neutral" },
};

const newId = () => `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** One-click starting points; each can be edited after adding. */
const PRESETS: { text: string; check: AssumptionCheck }[] = [
  { text: "Usage keeps growing", check: { metric: "feesGrowth90d", op: ">=", value: 0 } },
  { text: "Token holders keep getting paid", check: { metric: "holderShare", op: ">=", value: 0.1 } },
  { text: "Its narrative's fundamentals stay early", check: { metric: "narrativeStage", op: "in", value: null, stages: ["Emerging", "Accelerating"] } },
  { text: "Fundamentals stay solid", check: { metric: "fundamentalScore", op: ">=", value: 55 } },
  { text: "It stays reasonably valued", check: { metric: "priceToFees", op: "<=", value: 50 } },
];

const inputClass = "rounded border border-line bg-surface px-2 py-1 text-sm text-fg outline-none focus:border-brand";

/** The threshold as typed: percentages are shown in %, stored as fractions. */
const isPct = (m: CheckMetric) => CHECK_METRICS[m].unit === "pct";

function CheckEditor({ check, onChange }: { check: AssumptionCheck | null; onChange: (c: AssumptionCheck | null) => void }) {
  const metric = check?.metric ?? "";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={metric}
        onChange={(e) => {
          const m = e.target.value as CheckMetric | "";
          if (!m) return onChange(null);
          onChange(m === "narrativeStage" ? { metric: m, op: "in", value: null, stages: ["Emerging", "Accelerating"] } : { metric: m, op: ">=", value: 0 });
        }}
        className={inputClass}
      >
        <option value="">No data check</option>
        {(Object.keys(CHECK_METRICS) as CheckMetric[]).map((m) => (
          <option key={m} value={m}>
            {CHECK_METRICS[m].label}
          </option>
        ))}
      </select>
      {check && check.metric === "narrativeStage" && (
        <span className="flex flex-wrap gap-1">
          {STAGES.map((s) => {
            const on = (check.stages ?? []).includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => onChange({ ...check, stages: on ? (check.stages ?? []).filter((x) => x !== s) : [...(check.stages ?? []), s] })}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-brand bg-up/10 text-up" : "border-line text-muted"}`}
              >
                {s}
              </button>
            );
          })}
        </span>
      )}
      {check && check.metric !== "narrativeStage" && (
        <>
          <select value={check.op} onChange={(e) => onChange({ ...check, op: e.target.value as ">=" | "<=" })} className={inputClass}>
            <option value=">=">≥</option>
            <option value="<=">≤</option>
          </select>
          <input
            type="number"
            value={check.value === null ? "" : isPct(check.metric) ? Math.round(check.value * 1000) / 10 : check.value}
            onChange={(e) => {
              const n = e.target.value === "" ? null : Number(e.target.value);
              onChange({ ...check, value: n === null || !Number.isFinite(n) ? null : isPct(check.metric) ? n / 100 : n });
            }}
            className={`${inputClass} w-24`}
          />
          {isPct(check.metric) && <span className="text-xs text-muted">%</span>}
        </>
      )}
    </div>
  );
}

/** Stance, thesis, review date and assumptions, each assumption checked live against the coin's data. */
export function ThesisEditor({ thesis, onChange, profile, research }: { thesis: Thesis; onChange: (t: Thesis) => void; profile: CoinProfile; research: CoinResearch }) {
  const setAssumption = (id: string, patch: Partial<Assumption>) => onChange({ ...thesis, assumptions: thesis.assumptions.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  const unused = PRESETS.filter((p) => !thesis.assumptions.some((a) => a.text === p.text));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[auto_1fr_auto]">
        <label className="text-sm">
          <span className="font-semibold text-fg">Stance</span>
          <select
            value={thesis.stance ?? ""}
            onChange={(e) => onChange({ ...thesis, stance: (e.target.value || null) as Thesis["stance"] })}
            className={`${inputClass} mt-1 block w-full`}
          >
            <option value="">Undecided</option>
            <option value="bullish">Bullish</option>
            <option value="neutral">Neutral</option>
            <option value="bearish">Bearish</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="font-semibold text-fg">Thesis in a sentence</span>
          <input
            value={thesis.summary}
            onChange={(e) => onChange({ ...thesis, summary: e.target.value })}
            placeholder="e.g. Fees are growing faster than the token price in an early privacy narrative, and holders get a real share."
            className={`${inputClass} mt-1 block w-full`}
          />
        </label>
        <label className="text-sm">
          <span className="font-semibold text-fg">Review on</span>
          <input type="date" value={thesis.reviewOn ?? ""} onChange={(e) => onChange({ ...thesis, reviewOn: e.target.value || null })} className={`${inputClass} mt-1 block`} />
        </label>
      </div>

      <div>
        <div className="text-sm font-semibold text-fg">Key assumptions</div>
        <p className="text-xs text-subtle">What has to stay true. Add a data check and CoinScope re-checks it every time the coin is analyzed, and logs when it breaks.</p>
        <ul className="mt-2 space-y-2">
          {thesis.assumptions.map((a) => {
            const r = checkAssumption(a, profile, research);
            return (
              <li key={a.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2">
                <input
                  value={a.text}
                  onChange={(e) => setAssumption(a.id, { text: e.target.value })}
                  placeholder="What has to stay true…"
                  className={`${inputClass} min-w-48 flex-1`}
                />
                <CheckEditor check={a.check} onChange={(check) => setAssumption(a.id, { check })} />
                <span className="flex items-center gap-1.5" title={r.rule ?? undefined}>
                  <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  {r.status !== "unchecked" && <span className="tabular text-xs text-muted">now {r.current}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => onChange({ ...thesis, assumptions: thesis.assumptions.filter((x) => x.id !== a.id) })}
                  aria-label="Remove assumption"
                  className="px-1 text-subtle hover:text-down"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onChange({ ...thesis, assumptions: [...thesis.assumptions, { id: newId(), text: "", check: null }] })}
            className="rounded-md border border-line px-2.5 py-1 text-sm text-fg-2 hover:border-line-strong"
          >
            + Add assumption
          </button>
          {unused.length > 0 && <span className="text-xs text-subtle">or start from:</span>}
          {unused.map((p) => (
            <button
              key={p.text}
              type="button"
              onClick={() => onChange({ ...thesis, assumptions: [...thesis.assumptions, { id: newId(), text: p.text, check: p.check }] })}
              className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-xs text-muted hover:text-fg"
            >
              + {p.text}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

const EVIDENCE: { value: EvidenceStatus; label: string }[] = [
  { value: "verified", label: "Verified" },
  { value: "inferred", label: "Inferred" },
  { value: "unknown", label: "Unknown" },
];

/** How well a research answer is backed, and its sources. */
export function EvidenceRow({ tag, onChange }: { tag: EvidenceTag | undefined; onChange: (t: EvidenceTag) => void }) {
  const [link, setLink] = useState("");
  const current: EvidenceTag = tag ?? { status: null, sources: [] };
  const valid = /^https?:\/\/\S+$/i.test(link.trim());
  const add = () => {
    if (!valid) return;
    onChange({ ...current, sources: [...current.sources, link.trim()] });
    setLink("");
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
      <select
        value={current.status ?? ""}
        onChange={(e) => onChange({ ...current, status: (e.target.value || null) as EvidenceStatus | null })}
        className="rounded border border-line bg-surface px-1.5 py-0.5 text-fg-2"
        title="Verified: checked against a source. Inferred: your reasoning. Unknown: not established."
      >
        <option value="">Evidence: not tagged</option>
        {EVIDENCE.map((e) => (
          <option key={e.value} value={e.value}>
            {e.label}
          </option>
        ))}
      </select>
      {current.sources.map((s) => (
        <span key={s} className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5">
          <a href={s} target="_blank" rel="noreferrer" className="max-w-40 truncate text-up hover:underline">
            {s.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
          <button type="button" onClick={() => onChange({ ...current, sources: current.sources.filter((x) => x !== s) })} aria-label="Remove source" className="text-subtle hover:text-down">
            ✕
          </button>
        </span>
      ))}
      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder="Add a source link…"
        className="w-44 rounded border border-line bg-surface px-1.5 py-0.5 text-fg outline-none placeholder:text-subtle focus:border-brand"
      />
      {link && (
        <button type="button" onClick={add} disabled={!valid} className="text-up disabled:text-subtle">
          Add
        </button>
      )}
    </div>
  );
}

/** Thesis history, newest first. */
export function ThesisHistory({ events }: { events: ThesisEvent[] }) {
  const [all, setAll] = useState(false);
  if (!events.length) return <p className="text-sm text-muted">No history yet. Saving your thesis and analyzing the coin both add entries.</p>;
  const shown = all ? events : events.slice(0, 8);
  const tone = (k: ThesisEvent["kind"]) => (k === "assumption-broken" ? "text-down" : k === "assumption-holds" ? "text-up" : "text-fg-2");
  return (
    <div>
      <ul className="space-y-1 text-sm">
        {shown.map((e, i) => (
          <li key={`${e.at}-${i}`} className="flex gap-3">
            <span className="tabular w-16 shrink-0 text-xs text-subtle">
              {fmtDate(e.at)} {e.at.slice(2, 4)}
            </span>
            <span className={tone(e.kind)}>{e.detail}</span>
          </li>
        ))}
      </ul>
      {events.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-1 text-xs text-up hover:underline">
          {all ? "Show less" : `Show all ${events.length}`}
        </button>
      )}
    </div>
  );
}
