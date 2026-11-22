import type { Tone } from "@/lib/types";
import type { Verdict } from "@/lib/analysis/verdict";
import { Badge } from "./ui";

const DOT: Record<Tone, string> = { good: "text-up", neutral: "text-subtle", warn: "text-warn", bad: "text-down" };
const MARK: Record<Tone, string> = { good: "✓", neutral: "•", warn: "!", bad: "✕" };

/** A verdict's summary, its reasons and what would change it. */
export function VerdictPanel({ verdict, compact = false }: { verdict: Verdict; compact?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={verdict.tone}>{verdict.label}</Badge>
        <span className="text-base text-fg">{verdict.summary}</span>
      </div>
      <div className={`grid gap-4 ${compact ? "" : "lg:grid-cols-2"}`}>
        <div>
          <h4 className="text-sm font-bold text-fg">Why</h4>
          <ul className="mt-1 space-y-1 text-sm text-fg-2">
            {verdict.reasons.map((r) => (
              <li key={r.text} className="flex gap-2">
                <span className={`w-3 shrink-0 text-center font-bold ${DOT[r.tone]}`}>{MARK[r.tone]}</span>
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
        {verdict.changeIf.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-fg">Would become a strong candidate if</h4>
            <ul className="mt-1 space-y-1 text-sm text-fg-2">
              {verdict.changeIf.map((c) => (
                <li key={c}>→ {c}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
