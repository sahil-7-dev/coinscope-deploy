"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NarrativeStat } from "@/lib/types";
import { useChartColors } from "@/lib/theme";
import { fmtDate } from "@/lib/format";
import { STAGES } from "./NarrativeBadge";

/** A narrative's equal-weighted index against BTC over the last year (0% = in line with BTC). */
export function IndexVsBtcChart({ history, height = "h-48" }: { history: NarrativeStat["history"]; height?: string }) {
  const c = useChartColors();
  const points = history.map((h) => ({ date: h.date, pct: (h.ratio - 1) * 100, phase: h.phase }));
  return (
    <div>
      <div className={height}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fill: c.axis, fontSize: 11 }} minTickGap={40} />
            <YAxis tick={{ fill: c.axis, fontSize: 11 }} unit="%" width={48} />
            <ReferenceLine y={0} stroke={c.cursor} />
            <Tooltip
              content={({ active, payload }) => {
                const p = active && payload?.[0] ? (payload[0].payload as (typeof points)[number]) : null;
                return p ? (
                  <div className="rounded border border-line bg-surface px-2 py-1 text-xs">
                    <div className="text-fg">{fmtDate(p.date)}</div>
                    <div className="text-muted">
                      {p.pct >= 0 ? "+" : ""}
                      {p.pct.toFixed(1)}% vs BTC{p.phase ? ` · ${p.phase}` : ""}
                    </div>
                  </div>
                ) : null;
              }}
            />
            <Line type="monotone" dataKey="pct" stroke="var(--brand)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-subtle">0% = moving in line with BTC since a year ago. Rising line = beating BTC.</p>
    </div>
  );
}

/** One thin bar per day, colored by stage, with the stage legend. */
export function StageStrip({ days }: { days: NarrativeStat["stageHistory"] }) {
  if (!days.length) return null;
  return (
    <div>
      <div className="flex h-5 gap-px">
        {days.map((h) => (
          <span
            key={h.date}
            title={`${fmtDate(h.date)} ${h.date.slice(0, 4)}: ${h.stage ?? "no data"}`}
            className="flex-1 rounded-[1px]"
            style={{ background: h.stage ? STAGES[h.stage].color : "var(--surface-3)" }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-subtle">
        <span>
          {fmtDate(days[0].date)} {days[0].date.slice(0, 4)}
        </span>
        <span>today</span>
      </div>
    </div>
  );
}
