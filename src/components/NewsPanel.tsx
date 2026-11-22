"use client";

import { useEffect, useState } from "react";
import type { NewsResponse } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Spinner } from "./ui";

export function NewsPanel({ name, symbol, highlight }: { name: string; symbol: string; highlight?: { from: string; to: string } }) {
  const [data, setData] = useState<NewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<NewsResponse>(`/api/news?name=${encodeURIComponent(name)}&symbol=${encodeURIComponent(symbol)}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errMsg(err, "News failed to load")));
    return () => {
      cancelled = true;
    };
  }, [name, symbol]);

  if (error) return <p className="text-sm text-down">{error}</p>;
  if (!data) return <Spinner label="Loading news…" />;
  return (
    <div className="space-y-2">
      {data.items.length === 0 ? (
        <p className="text-sm text-subtle">No recent headlines mention {name}.</p>
      ) : (
        <ul className="space-y-1.5">
          {data.items.map((n) => {
            const day = n.publishedAt.slice(0, 10);
            const inRun = highlight && day >= highlight.from && day <= highlight.to;
            return (
              <li key={n.url} className="flex gap-3 text-sm">
                <span className={`tabular w-14 shrink-0 text-xs ${inRun ? "text-warn" : "text-subtle"}`}>{fmtDate(day)}</span>
                <a href={n.url} target="_blank" rel="noreferrer" className="text-fg hover:text-brand-strong">
                  {n.title}
                </a>
                <span className="ml-auto shrink-0 text-xs text-subtle">{n.source}</span>
              </li>
            );
          })}
        </ul>
      )}
      {data.note && <p className="text-sm text-faint">{data.note}</p>}
    </div>
  );
}
