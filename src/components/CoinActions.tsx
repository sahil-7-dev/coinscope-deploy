"use client";

import Link from "next/link";
import { useState } from "react";
import type { CoinProfile } from "@/lib/types";
import { api, errMsg, toPicked } from "@/lib/api";
import { addCoin, useCandidates, useWinners } from "@/lib/useStored";
import { Button } from "./ui";

/** Save as reference / watch / use as winner or candidate / open detail page. */
export function CoinActions({ p, showOpen = true }: { p: CoinProfile; showOpen?: boolean }) {
  const [status, setStatus] = useState<Record<string, "busy" | "done" | string>>({});
  const [winners, setWinners] = useWinners();
  const [candidates, setCandidates] = useCandidates();

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setStatus((s) => ({ ...s, [key]: "busy" }));
    try {
      await fn();
      setStatus((s) => ({ ...s, [key]: "done" }));
    } catch (err) {
      setStatus((s) => ({ ...s, [key]: errMsg(err, "Failed") }));
    }
  };

  const label = (key: string, idle: string, done: string) =>
    status[key] === "busy" ? "Saving…" : status[key] === "done" ? done : status[key] ? `⚠ ${idle}` : idle;
  const coin = toPicked(p);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="ghost" disabled={status.ref === "busy" || status.ref === "done"} onClick={() => run("ref", () => api("/api/library", { body: { id: p.id } }))}>
        {label("ref", "★ Save as reference", "★ Saved to library")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={status.watch === "busy" || status.watch === "done"}
        onClick={() => run("watch", () => api("/api/watchlist", { body: { id: p.id, name: p.name, symbol: p.symbol, image: p.image } }))}
      >
        {label("watch", "👁 Watch", "👁 Watching")}
      </Button>
      <Button size="sm" variant="ghost" disabled={winners.some((c) => c.id === p.id)} onClick={() => setWinners((l) => addCoin(l, coin))}>
        {winners.some((c) => c.id === p.id) ? "✓ Winner" : "+ Winner"}
      </Button>
      <Button size="sm" variant="ghost" disabled={candidates.some((c) => c.id === p.id)} onClick={() => setCandidates((l) => addCoin(l, coin))}>
        {candidates.some((c) => c.id === p.id) ? "✓ Candidate" : "+ Candidate"}
      </Button>
      <Link
        href={`/journal?${new URLSearchParams({ coin: p.id, name: p.name, symbol: p.symbol, ...(p.image ? { thumb: p.image } : {}) })}`}
        className="inline-flex items-center rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-fg-2 hover:bg-surface-3 hover:text-fg"
      >
        📓 Log decision
      </Link>
      {showOpen && (
        <Link href={`/coin/${p.id}`} className="text-xs text-up hover:text-brand-strong">
          Full analysis →
        </Link>
      )}
      {Object.values(status).some((s) => s !== "busy" && s !== "done") && (
        <span className="text-xs text-down">{Object.values(status).find((s) => s !== "busy" && s !== "done")}</span>
      )}
    </div>
  );
}
