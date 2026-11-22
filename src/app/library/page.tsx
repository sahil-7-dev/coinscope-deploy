"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LibraryEntry, PickedCoin } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtPct, fmtPrice, fmtUsd, fmtX } from "@/lib/format";
import { Badge, Button, Card, CoinIcon, ErrorBox, Pct, SectionTitle, Spinner } from "@/components/ui";
import { CoinPicker } from "@/components/CoinPicker";
import { MiniScores } from "@/components/ScoresPanel";

const NO_COINS: PickedCoin[] = [];

export default function LibraryPage() {
  const [entries, setEntries] = useState<LibraryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ entries: LibraryEntry[] }>("/api/library")
      .then((r) => !cancelled && setEntries(r.entries))
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load library")));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errMsg(err, "Action failed"));
    } finally {
      setBusy(null);
    }
  };

  const add = (coins: PickedCoin[]) => {
    const c = coins[coins.length - 1];
    if (c) act(`Analyzing ${c.name} and saving it…`, () => api("/api/library", { body: { id: c.id } }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">Reference Library</h1>
        <p className="mt-1 max-w-4xl text-base text-muted">
          Coins you&apos;ve saved as examples of what a good investment looked like. Their metrics are stored locally (in <code>data/coinscope.db</code>) and
          used by the <Link href="/similarity" className="text-up hover:underline">Coin Check</Link>.
        </p>
      </div>

      <Card>
        <SectionTitle title="Add a reference" subtitle="The coin is analyzed now and its full metrics are saved. Re-analyze any time to update them." />
        <CoinPicker value={NO_COINS} onChange={add} placeholder="Search a coin to save…" />
      </Card>

      {busy && <Spinner label={busy} />}
      {error && <ErrorBox message={error} />}
      {!entries && !error && <Spinner label="Loading library…" />}
      {entries?.length === 0 && <p className="text-sm text-subtle">No references yet. Add one above, or click ★ Save as reference on any coin.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {entries?.map((e) => (
          <ReferenceCard
            key={e.id}
            e={e}
            disabled={busy !== null}
            onRefresh={() => act(`Re-analyzing ${e.name}…`, () => api("/api/library", { body: { id: e.id, note: e.note } }))}
            onDelete={() => act(`Removing ${e.name}…`, () => api(`/api/library?id=${encodeURIComponent(e.id)}`, { method: "DELETE" }))}
            onNote={(note) => act("Saving note…", () => api("/api/library", { method: "PATCH", body: { id: e.id, note } }))}
          />
        ))}
      </div>
    </div>
  );
}

function ReferenceCard({
  e,
  disabled,
  onRefresh,
  onDelete,
  onNote,
}: {
  e: LibraryEntry;
  disabled: boolean;
  onRefresh: () => void;
  onDelete: () => void;
  onNote: (note: string) => void;
}) {
  const p = e.profile;
  const f = p.fundamentals;
  const [note, setNote] = useState(e.note);
  const stats: [string, string][] = [
    ["Price", fmtPrice(p.price)],
    ["Market cap", fmtUsd(p.marketCap)],
    ["Fees 30d", fmtUsd(f?.fees30d)],
    ["P/F", fmtX(f?.priceToFees)],
    ["TVL", fmtUsd(f?.tvl)],
    ["Circulating", fmtPct(p.tokenomics.circulatingRatio, { signed: false })],
  ];

  return (
    <Card className="space-y-3">
      <div className="flex items-center gap-2">
        <CoinIcon src={e.image} alt={e.name} size={26} />
        <Link href={`/coin/${e.id}`} className="font-semibold text-fg hover:text-brand-strong">
          {e.name}
        </Link>
        <span className="text-sm text-subtle">{e.symbol}</span>
        <span className="ml-auto text-xs text-subtle">saved {fmtDate(e.savedAt)}</span>
      </div>

      {p.rally ? (
        <p className="text-sm text-fg-2">
          Run: <Pct value={p.rally.gain} /> in {p.rally.days} days ({fmtDate(p.rally.lowDate)} → {fmtDate(p.rally.peakDate)})
        </p>
      ) : (
        <p className="text-sm text-subtle">No 20%+ run in the 90 days before saving.</p>
      )}

      <div className="tabular grid grid-cols-3 gap-2 text-sm">
        {stats.map(([k, v]) => (
          <div key={k}>
            <div className="text-xs text-subtle">{k}</div>
            <div className="text-fg">{v}</div>
          </div>
        ))}
      </div>

      <MiniScores scores={p.scores} />

      <div className="flex flex-wrap gap-1.5">
        {p.drivers
          .filter((d) => d.strength !== "weak")
          .slice(0, 4)
          .map((d) => (
            <Badge key={d.title} tone={d.strength === "strong" ? "good" : "warn"}>
              {d.title}
            </Badge>
          ))}
      </div>

      <input
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
        onBlur={() => note !== e.note && onNote(note)}
        placeholder="Add a note (why this is a good reference)…"
        className="w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none placeholder:text-subtle focus:border-brand"
      />

      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onRefresh}>
          ↻ Re-analyze
        </Button>
        <Button size="sm" variant="ghost" disabled={disabled} onClick={onDelete}>
          Remove
        </Button>
      </div>
    </Card>
  );
}
