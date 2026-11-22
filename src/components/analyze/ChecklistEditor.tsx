"use client";

import type { Checklist, ChecklistItem } from "@/lib/types";
import { describeItem, formatMetric, inputScale, METRICS } from "@/lib/analysis/checklist";

export function ChecklistEditor({ checklist, onChange }: { checklist: Checklist; onChange: (next: Checklist) => void }) {
  const n = checklist.winners.length;
  const names = new Map(checklist.winners.map((w) => [w.id, w.name]));

  const update = (id: string, patch: Partial<ChecklistItem>) =>
    onChange({
      ...checklist,
      items: checklist.items.map((i) => (i.id === id ? ({ ...i, ...patch } as ChecklistItem) : i)),
    });

  if (!checklist.items.length) {
    return <p className="text-sm text-muted">The winners had too little in common to build a checklist. Try adding more, or more similar, winners.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="w-8 py-2" />
            <th className="py-2">Criterion</th>
            <th className="py-2">Target</th>
            <th className="py-2">Weight</th>
            <th className="py-2">Winners matching</th>
            <th className="py-2 text-right">Winners&apos; median</th>
          </tr>
        </thead>
        <tbody>
          {checklist.items.map((item) => {
            const { label, why } = describeItem(item);
            const def = item.kind === "metric" ? METRICS[item.metric] : null;
            return (
              <tr key={item.id} className={`border-b border-line align-top ${item.enabled ? "" : "opacity-40"}`}>
                <td className="py-2.5">
                  <input
                    type="checkbox"
                    checked={item.enabled}
                    onChange={(e) => update(item.id, { enabled: e.target.checked })}
                    className="h-4 w-4 accent-brand"
                    aria-label={`Use ${label}`}
                  />
                </td>
                <td className="py-2.5 pr-3">
                  <div className="text-fg">{label}</div>
                  <div className="text-xs text-subtle">{why}</div>
                </td>
                <td className="py-2.5 pr-3">
                  {item.kind === "metric" && def ? (
                    <label className="inline-flex items-center gap-1.5 text-fg-2">
                      <span className="text-subtle">{item.op === ">=" ? "≥" : "≤"}</span>
                      <input
                        type="number"
                        step="any"
                        value={+(item.threshold * inputScale[def.unit].factor).toPrecision(6)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (Number.isFinite(v)) update(item.id, { threshold: v / inputScale[def.unit].factor });
                        }}
                        className="tabular w-20 rounded border border-line bg-surface px-2 py-1 text-right outline-none focus:border-brand"
                      />
                      <span className="text-xs text-subtle">{inputScale[def.unit].suffix}</span>
                    </label>
                  ) : (
                    <span className="text-muted">Has this tag</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  <select
                    value={item.weight}
                    onChange={(e) => update(item.id, { weight: Number(e.target.value) })}
                    className="rounded border border-line bg-surface px-2 py-1 outline-none"
                  >
                    {[1, 2, 3, 4, 5].map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="tabular text-fg">
                    {item.matched.length}/{n}
                  </span>
                  <div className="text-xs text-subtle">{item.matched.map((id) => names.get(id) ?? id).join(", ")}</div>
                </td>
                <td className="tabular py-2.5 text-right text-muted">
                  {item.kind === "metric" && def ? formatMetric(def.unit, item.winnerMedian) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
