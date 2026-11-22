"use client";

import { Area, Bar, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PricePoint, Rally } from "@/lib/types";
import { fmtDate, fmtPrice, fmtUsd } from "@/lib/format";
import { useChartColors } from "@/lib/theme";

export function PriceVolumeChart({ series, rally, height = 220 }: { series: PricePoint[]; rally: Rally | null; height?: number }) {
  const c = useChartColors();
  const maxVol = Math.max(...series.map((p) => p.volume), 1);
  const up = series.length > 1 && series[series.length - 1].price >= series[0].price;
  const color = up ? c.up : c.down;
  const markers = rally
    ? [
        { x: rally.lowDate, label: "Low", color: c.axis, position: "insideBottomLeft" as const },
        { x: rally.breakoutDate, label: "Breakout", color: c.warn, position: "insideTopLeft" as const },
        { x: rally.peakDate, label: "Peak", color: c.up, position: "top" as const },
      ]
    : [];

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 16, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" tickFormatter={fmtDate} minTickGap={48} tick={{ fill: c.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="price"
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => fmtPrice(v)}
            tick={{ fill: c.axis, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={68}
          />
          <YAxis yAxisId="vol" orientation="right" hide domain={[0, maxVol * 4]} />
          <Bar yAxisId="vol" dataKey="volume" fill={c.volume} isAnimationActive={false} />
          <Area
            yAxisId="price"
            type="monotone"
            dataKey="price"
            stroke={color}
            strokeWidth={1.75}
            fill="url(#priceFill)"
            dot={false}
            isAnimationActive={false}
          />
          {markers.map((m) => (
            <ReferenceLine
              key={m.label}
              yAxisId="price"
              x={m.x}
              stroke={m.color}
              strokeDasharray="3 3"
              label={{ value: m.label, position: m.position, fill: m.color, fontSize: 10, fontWeight: 600 }}
            />
          ))}
          <Tooltip
            cursor={{ stroke: c.cursor }}
            content={({ active, payload }) => {
              const p = active && payload?.[0] ? (payload[0].payload as PricePoint) : null;
              if (!p) return null;
              return (
                <div className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg">
                  <div className="text-muted">{fmtDate(p.date)}</div>
                  <div className="tabular text-fg">{fmtPrice(p.price)}</div>
                  <div className="tabular text-subtle">Vol {fmtUsd(p.volume)}</div>
                </div>
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
