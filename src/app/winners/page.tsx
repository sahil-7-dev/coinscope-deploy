"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { LibraryEntry, PickedCoin } from "@/lib/types";
import type { WinnerDetail, WinnerRun } from "@/lib/analysis/winner-pattern";
import { buildPattern, FEATURES, patternDifferences, type FundamentalSnapshot } from "@/lib/analysis/similarity";
import { api, errMsg } from "@/lib/api";
import { useStored } from "@/lib/useStored";
import { fmtDate } from "@/lib/format";
import { Badge, Button, Card, CoinIcon, ErrorBox, PageHeader, SectionTitle, Spinner } from "@/components/ui";
import { CoinPicker } from "@/components/CoinPicker";
import { StageBadge } from "@/components/NarrativeBadge";

const NO_IDS: string[] = [];
const NO_COINS: PickedCoin[] = [];
/** Metrics that can be known on a past date (TVL, listings and developer activity have no cheap history). */
const PAST_KEYS = ["fees30d", "feesGrowth30d", "feesGrowth90d", "revenueGrowth90d", "holderShare", "revenueShare", "priceToFees", "priceToSales", "marketCap", "circulatingRatio", "inflation", "fdvToMcap", "ageDays"];
const ROWS = FEATURES.filter((f) => PAST_KEYS.includes(f.key));

interface Loaded {
  detail: WinnerDetail;
  saved: string | null;
  name: string;
  symbol: string;
  image: string | null;
}

const value = (s: FundamentalSnapshot | null, f: (typeof ROWS)[number]) => {
  const v = s?.[f.key];
  return v === null || v === undefined || !Number.isFinite(v) ? "—" : f.fmt(v);
};
const year = (d: string) => d.slice(0, 4);
const runLabel = (r: WinnerRun) => `+${Math.round(r.gain * 100)}% from ${fmtDate(r.lowDate)} ${year(r.lowDate)} to ${fmtDate(r.peakDate)} ${year(r.peakDate)}`;

export default function WinnersPage() {
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null);
  // Same selection as Coin Check, so both pages work on the same benchmarks.
  const [selected, setSelected] = useStored<string[]>("coinscope.simRefs", NO_IDS);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<{ entries: LibraryEntry[] }>("/api/library")
      .then((r) => !cancelled && setLibrary(r.entries))
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load library")));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const load = useCallback(async (id: string) => {
    try {
      const r = await api<Loaded>(`/api/winners?id=${encodeURIComponent(id)}`);
      setLoaded((m) => ({ ...m, [id]: r }));
    } catch (err) {
      setError(errMsg(err, `Couldn't load ${id}`));
    }
  }, []);

  const ids = useMemo(() => (library ?? []).filter((e) => selected.includes(e.id)).map((e) => e.id), [library, selected]);
  const missing = ids.filter((id) => !loaded[id]).join(",");

  useEffect(() => {
    let cancelled = false;
    for (const id of missing.split(",").filter(Boolean)) {
      api<Loaded>(`/api/winners?id=${encodeURIComponent(id)}`)
        .then((r) => !cancelled && setLoaded((m) => ({ ...m, [id]: r })))
        .catch((err) => !cancelled && setError(errMsg(err, `Couldn't load ${id}`)));
    }
    return () => {
      cancelled = true;
    };
  }, [missing]);

  const choose = async (id: string, asOf: string | null) => {
    setBusy(`Updating ${loaded[id]?.symbol ?? id}…`);
    setError(null);
    try {
      await api("/api/winners", { body: { id, asOf } });
      await load(id);
    } catch (err) {
      setError(errMsg(err, "Couldn't save"));
    } finally {
      setBusy(null);
    }
  };

  const addWinner = async (coins: PickedCoin[]) => {
    const c = coins.find((x) => !library?.some((e) => e.id === x.id));
    if (!c) return;
    setBusy(`Analyzing ${c.name} and saving it to your library…`);
    try {
      await api("/api/library", { body: { id: c.id } });
      setSelected((s) => [...new Set([...s, c.id])]);
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errMsg(err, `Failed to save ${c.name}`));
    } finally {
      setBusy(null);
    }
  };

  const shown = ids.map((id) => loaded[id]).filter((x): x is Loaded => !!x);
  const befores = shown.map((l) => l.detail.before).filter((b): b is FundamentalSnapshot => !!b);
  const pattern = befores.length >= 2 ? buildPattern(befores) : [];
  const differences = befores.length >= 2 ? patternDifferences(befores) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Winners"
        subtitle="Study coins that already performed well: every run since 2021, their fundamentals before each run (what was known at the time) next to the peak (hindsight), and what they had in common. Your choice of run is what Coin Check compares against."
      />

      <Card>
        <SectionTitle title="Winners to study" subtitle="From your Library; the same selection as Coin Check's benchmarks." />
        {!library ? (
          <Spinner label="Loading library…" />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {library.map((e) => {
                const on = selected.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => setSelected((s) => (on ? s.filter((x) => x !== e.id) : [...s, e.id]))}
                    className={`inline-flex items-center gap-1.5 rounded-full border py-1 pl-1.5 pr-3 text-sm transition ${
                      on ? "border-brand bg-up/10 text-up" : "border-line text-muted hover:border-line-strong"
                    }`}
                  >
                    <CoinIcon src={e.image} alt={e.name} size={18} />
                    {on ? "✓ " : ""}
                    {e.name}
                  </button>
                );
              })}
            </div>
            <CoinPicker value={NO_COINS} onChange={addWinner} placeholder="Add a winner by name, e.g. Zcash (it gets analyzed and saved)…" />
          </div>
        )}
      </Card>

      {busy && <Spinner label={busy} />}
      {error && <ErrorBox message={error} />}

      {ids.length > 0 && shown.length < ids.length && <Spinner label="Finding each winner's runs since 2021…" />}

      {shown.map((l) => (
        <WinnerCard key={l.detail.id} l={l} busy={busy !== null} onChoose={(asOf) => choose(l.detail.id, asOf)} />
      ))}

      {befores.length >= 2 && (
        <Card>
          <SectionTitle
            title="Side by side, before their runs"
            subtitle="Each winner as of the day before its chosen run began. Shared ranges become the pattern Coin Check matches candidates against."
            right={
              <Link href={`/similarity?benchmarks=${ids.join(",")}`} className="text-sm font-semibold text-brand-strong hover:underline">
                Find coins matching this pattern →
              </Link>
            }
          />
          <div className="overflow-x-auto">
            <table className="tabular w-full min-w-[640px] text-sm">
              <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
                <tr className="border-b border-line">
                  <th className="py-1.5 pr-3">Metric</th>
                  {befores.map((b) => (
                    <th key={b.id} className="px-2 py-1.5 text-right">
                      {b.symbol}
                      <div className="font-normal text-subtle">{b.asOf}</div>
                    </th>
                  ))}
                  <th className="py-1.5 pl-3">Shared range</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line">
                  <td className="py-1.5 pr-3 text-muted">Narrative stage</td>
                  {befores.map((b) => (
                    <td key={b.id} className="px-2 py-1.5 text-right">
                      <StageBadge stage={b.narrativeStage} />
                    </td>
                  ))}
                  <td className="py-1.5 pl-3 text-xs text-subtle">—</td>
                </tr>
                {ROWS.map((f) => {
                  const p = pattern.find((m) => m.key === f.key);
                  return (
                    <tr key={f.key} className="border-b border-line">
                      <td className="py-1.5 pr-3 text-muted">{f.label}</td>
                      {befores.map((b) => (
                        <td key={b.id} className="px-2 py-1.5 text-right text-fg-2">
                          {value(b, f)}
                        </td>
                      ))}
                      <td className={`py-1.5 pl-3 text-xs ${p && !p.tooWide ? "text-fg-2" : "text-subtle"}`}>{!p ? "—" : p.tooWide ? "too wide to tell" : p.display}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {differences.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-bold text-fg">What they did not share</h3>
              <ul className="mt-1 space-y-1 text-sm text-fg-2">
                {differences.map((d) => (
                  <li key={d}>• {d}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function WinnerCard({ l, busy, onChoose }: { l: Loaded; busy: boolean; onChoose: (asOf: string | null) => void }) {
  const { detail: d } = l;
  const [date, setDate] = useState("");
  const asOf = d.before?.asOf;
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CoinIcon src={l.image} alt={l.name} />
        <h2 className="text-lg font-bold text-fg">{l.name}</h2>
        <span className="text-subtle">{l.symbol}</span>
        {d.custom ? <Badge tone="neutral">Your choice</Badge> : <Badge tone="good">Default: biggest recent run</Badge>}
        <Link href={`/coin/${d.id}`} className="ml-auto text-sm text-up hover:underline">
          Full report →
        </Link>
      </div>
      <p className="text-sm text-fg-2">
        {asOf ? (
          <>
            Compared as of <b>{fmtDate(asOf)} {year(asOf)}</b>
            {d.run ? `, the day before the run of ${runLabel(d.run)}.` : "."}
          </>
        ) : (
          (d.note ?? "No comparison date.")
        )}
      </p>
      {asOf && d.note && <p className="mt-1 text-sm text-muted">{d.note}</p>}
      {d.before?.approx?.map((a) => (
        <p key={a} className="mt-1 text-xs text-warn">
          {a}
        </p>
      ))}

      <div className="mt-4 grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <div>
          <h3 className="text-sm font-bold text-fg">Runs since 2021</h3>
          {d.runs.length === 0 ? (
            <p className="mt-1 text-sm text-muted">No run of +50% or more.</p>
          ) : (
            <ul className="mt-1 max-h-64 space-y-1 overflow-auto text-sm">
              {d.runs.map((r) => {
                const active = d.run?.breakoutDate === r.breakoutDate;
                return (
                  <li key={r.breakoutDate} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2 py-1 ${active ? "border-brand bg-up/5" : "border-line"}`}>
                    <span className="text-fg-2">
                      {runLabel(r)}
                      {r.approx && <span className="ml-1 text-xs text-warn">estimated market cap</span>}
                    </span>
                    {active ? (
                      <span className="text-xs text-up">compared</span>
                    ) : (
                      <button type="button" disabled={busy} onClick={() => onChoose(r.breakoutDate)} className="text-xs text-up hover:underline disabled:text-subtle">
                        Use this run
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Or compare as of a date:</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-fg" />
            <Button size="sm" variant="ghost" onClick={() => onChoose(date)} disabled={busy || !date}>
              Use date
            </Button>
            {d.custom && (
              <Button size="sm" variant="ghost" onClick={() => onChoose(null)} disabled={busy}>
                Back to default
              </Button>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-bold text-fg">Before the run vs at its peak</h3>
          <p className="text-xs text-subtle">The left column is what was known at the time. The peak is hindsight: what happened during the run, not a signal you could have used.</p>
          <table className="tabular mt-2 w-full text-sm">
            <thead className="text-left text-xs font-bold text-fg">
              <tr className="border-b border-line">
                <th className="py-1">Metric</th>
                <th className="py-1 text-right">Before {asOf ? `(${asOf})` : ""}</th>
                <th className="py-1 text-right text-muted">At peak {d.atPeak?.asOf ? `(${d.atPeak.asOf})` : ""}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line">
                <td className="py-1 text-muted">Narrative stage</td>
                <td className="py-1 text-right">
                  <StageBadge stage={d.before?.narrativeStage} />
                </td>
                <td className="py-1 text-right">
                  <StageBadge stage={d.atPeak?.narrativeStage} />
                </td>
              </tr>
              {ROWS.map((f) => (
                <tr key={f.key} className="border-b border-line">
                  <td className="py-1 text-muted">{f.label}</td>
                  <td className="py-1 text-right text-fg-2">{value(d.before, f)}</td>
                  <td className="py-1 text-right text-muted">{value(d.atPeak, f)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-subtle">TVL, exchange listings and developer activity aren&apos;t shown: there&apos;s no free history for past dates.</p>
        </div>
      </div>
    </Card>
  );
}
