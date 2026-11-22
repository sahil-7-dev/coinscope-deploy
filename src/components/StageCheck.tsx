"use client";

import { useEffect, useState } from "react";
import type { StageValidation } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { fmtPct } from "@/lib/format";
import { stageFinding } from "@/lib/analysis/stage-check";
import { Badge, Card, ErrorBox, Pct, SectionTitle, Spinner } from "./ui";
import { StageBadge } from "./NarrativeBadge";

const share = (x: number | null) => fmtPct(x, { signed: false, digits: 0 });

export function useStageCheck() {
  const [data, setData] = useState<StageValidation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<StageValidation>("/api/narratives/stage-check")
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to run the stage check")));
    return () => {
      cancelled = true;
    };
  }, []);
  return { data, error };
}

/** Does the narrative stage tell you anything? Stability, and what followed each stage, across all narratives since 2021. */
export function StageCheck() {
  const { data: v, error } = useStageCheck();
  const finding = v ? stageFinding(v) : null;
  return (
    <Card>
      <div id="stage-check" className="scroll-mt-24" />
      <SectionTitle
        title="Narrative stage check"
        subtitle="Every narrative's stage replayed daily since 2021 from data known on each day, then: how often it changed, and what the narrative's coins did over the next 90 days compared with BTC and with the typical narrative over the same days."
      />
      {error && <ErrorBox message={error} />}
      {!v && !error && <Spinner label="Replaying every narrative's stage…" />}
      {v && finding && (
        <div className="space-y-5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={finding.tone}>{finding.tone === "good" ? "Signal" : finding.tone === "neutral" ? "Warning only" : "No reliable signal"}</Badge>
              <span className="text-sm text-fg">{finding.text}</span>
            </div>
            <p className="mt-2 text-sm text-fg-2">{finding.stability}</p>
            <p className="mt-1 text-xs text-subtle">
              {v.narratives} narratives, {v.narrativeYears.toFixed(0)} narrative-years of daily stages ({v.from?.slice(0, 4)}–{v.to?.slice(0, 4)}). A new stage must hold{" "}
              {v.confirmDays} days.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs font-bold text-fg">
                <tr className="border-b border-line">
                  <th className="py-1.5">Stage</th>
                  <th className="py-1.5 text-right">Times entered</th>
                  <th className="py-1.5 text-right">Lasts (median)</th>
                  <th className="py-1.5 text-right">Reversed &lt;30d</th>
                  <th className="py-1.5 text-right">Next 90d vs BTC</th>
                  <th className="py-1.5 text-right">vs typical narrative</th>
                  <th className="py-1.5 text-right">Beat it</th>
                  {v.periods.map((p) => (
                    <th key={p.label} className="py-1.5 text-right">
                      {p.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {v.stages.map((s) => (
                  <tr key={s.stage} className="border-b border-line">
                    <td className="py-1.5">
                      <StageBadge stage={s.stage} />
                    </td>
                    <td className="py-1.5 text-right text-fg-2">{s.calls}</td>
                    <td className="py-1.5 text-right text-fg-2">{s.medianDays === null ? "—" : `${s.medianDays} days`}</td>
                    <td className="py-1.5 text-right text-fg-2">{share(s.reversed)}</td>
                    <td className="py-1.5 text-right">
                      <Pct value={s.vsBtc90} />
                    </td>
                    <td className="py-1.5 text-right">
                      <Pct value={s.vsOthers90} />
                    </td>
                    <td className="py-1.5 text-right text-fg-2">{share(s.beatOthers90)}</td>
                    {v.periods.map((p) => {
                      const r = p.stages.find((x) => x.stage === s.stage);
                      return (
                        <td key={p.label} className="py-1.5 text-right">
                          <Pct value={r?.vsOthers90 ?? null} /> <span className="text-xs text-subtle">({r?.calls ?? 0})</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="-mt-3 text-xs text-subtle">
            Medians over each time a narrative entered the stage, measured from the day the stage was confirmed. &quot;Typical narrative&quot; = the median of all tracked
            narratives over the same 90 days, so a stage with no signal sits near 0% and beats it about half the time. Most narratives trail BTC in most periods, which is
            why &quot;vs BTC&quot; is negative across the board.
          </p>

          <div>
            <h3 className="mb-1 text-sm font-bold text-fg">How long a new stage must hold</h3>
            <p className="mb-2 text-xs text-subtle">
              Shorter holds react sooner but flip back and forth; longer holds are steadier but later. &quot;Early calls&quot; = entering Emerging or Accelerating.
            </p>
            <div className="overflow-x-auto">
              <table className="tabular w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs font-bold text-fg">
                  <tr className="border-b border-line">
                    <th className="py-1.5">Hold</th>
                    <th className="py-1.5 text-right">Changes a year</th>
                    <th className="py-1.5 text-right">Reversed &lt;30d</th>
                    <th className="py-1.5 text-right">Early calls</th>
                    <th className="py-1.5 text-right">Early vs typical (90d)</th>
                    <th className="py-1.5 text-right">{v.periods[0]?.label}</th>
                    <th className="py-1.5 text-right">{v.periods[1]?.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {v.variants.map((x) => (
                    <tr key={x.days} className={`border-b border-line ${x.days === v.confirmDays ? "font-semibold" : ""}`}>
                      <td className="py-1.5 text-fg">
                        {x.days} {x.days === 1 ? "day" : "days"}
                        {x.days === v.confirmDays && <span className="ml-1 text-xs font-normal text-brand-strong">(used)</span>}
                      </td>
                      <td className="py-1.5 text-right text-fg-2">{x.changesPerYear.toFixed(1)}</td>
                      <td className="py-1.5 text-right text-fg-2">{share(x.reversed)}</td>
                      <td className="py-1.5 text-right text-fg-2">{x.earlyCalls}</td>
                      <td className="py-1.5 text-right">
                        <Pct value={x.earlyVsOthers90} />
                      </td>
                      <td className="py-1.5 text-right">
                        <Pct value={x.earlyBefore} />
                      </td>
                      <td className="py-1.5 text-right">
                        <Pct value={x.earlyFrom} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <ul className="list-disc space-y-1 pl-5 text-xs text-subtle">
            {v.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
