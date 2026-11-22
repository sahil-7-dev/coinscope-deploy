"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { CoinProfile, CoinResearch, LibraryEntry, MarketPulse, PickedCoin, StrategyBacktestResult } from "@/lib/types";
import { api, errMsg, fetchProfiles, profileErrors } from "@/lib/api";
import {
  buildPattern,
  compareCoins,
  GROUPS,
  matchPattern,
  similarityLabel,
  snapshotOf,
  type FundamentalSnapshot,
  type PatternMatch,
  type PatternMetric,
  type SimilarityResult,
} from "@/lib/analysis/similarity";
import type { PreMove } from "@/lib/analysis/winner-pattern";
import { verdictFor, type Verdict, type VerdictKind } from "@/lib/analysis/verdict";
import { useStored } from "@/lib/useStored";
import { fmtDate, fmtPct } from "@/lib/format";
import { Badge, Button, Card, CoinIcon, ErrorBox, PageHeader, SectionTitle, Spinner } from "@/components/ui";
import { CoinPicker } from "@/components/CoinPicker";
import { ScoreBar } from "@/components/ScoresPanel";
import { CoinNarrativeChip } from "@/components/NarrativeBadge";
import { VerdictPanel } from "@/components/VerdictPanel";

const NO_IDS: string[] = [];
const NO_COINS: PickedCoin[] = [];
const ORDER: Record<VerdictKind, number> = { strong: 0, watch: 1, speculative: 2, avoid: 3 };
/** How many recent top performers the one-click button adds as references. */
const TOP_PERFORMERS = 5;

function cellColor(score: number | null) {
  if (score === null) return "text-faint";
  return score >= 75 ? "bg-up/15 text-up" : score >= 60 ? "bg-up/10 text-up" : score >= 45 ? "bg-warn/10 text-warn" : "text-down";
}

function scoreText(s: number | null, risk = false) {
  if (s === null) return "text-subtle";
  const v = risk ? 100 - s : s;
  return v >= 55 ? "text-up" : v >= 40 ? "text-warn" : "text-down";
}

interface Row {
  cand: CoinProfile;
  results: SimilarityResult[];
  pattern: PatternMatch | null;
  verdict: Verdict;
}

/** "before" compares with each winner the day its run began (the setup); "today" with the winner now (after the move). */
type Mode = "before" | "today";

export default function CoinCheckPage() {
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null);
  const [selectedRefs, setSelectedRefs] = useStored<string[]>("coinscope.simRefs", NO_IDS);
  const [candidates, setCandidates] = useStored<PickedCoin[]>("coinscope.simCandidates", NO_COINS);
  const [paste, setPaste] = useState("");
  const [profiles, setProfiles] = useState<CoinProfile[] | null>(null);
  const [research, setResearch] = useState<Record<string, CoinResearch>>({});
  const [backtest, setBacktest] = useState<StrategyBacktestResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<{ cand: string; ref: string | null } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [mode, setMode] = useState<Mode>("before");
  const [winners, setWinners] = useState<Record<string, PreMove>>({});

  useEffect(() => {
    let cancelled = false;
    api<{ entries: LibraryEntry[] }>("/api/library")
      .then((r) => !cancelled && setLibrary(r.entries))
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load library")));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  useEffect(() => {
    let cancelled = false;
    api<{ latest: StrategyBacktestResult | null }>("/api/strategy-backtest")
      .then((r) => !cancelled && setBacktest(r.latest))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const refs = useMemo(() => (library ?? []).filter((e) => selectedRefs.includes(e.id)), [library, selectedRefs]);
  const refIds = refs.map((r) => r.id).join(",");

  // Each benchmark's biggest run of the last year, and its fundamentals the day before it began.
  useEffect(() => {
    if (!refIds) return;
    let cancelled = false;
    api<{ results: PreMove[] }>(`/api/winner-pattern?ids=${encodeURIComponent(refIds)}`)
      .then((r) => !cancelled && setWinners((w) => ({ ...w, ...Object.fromEntries(r.results.map((x) => [x.id, x])) })))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refIds]);

  /** A benchmark as it's compared: before its run when that's chosen and known, otherwise today. */
  const refSnapshot = useCallback(
    (e: LibraryEntry): FundamentalSnapshot => (mode === "before" && winners[e.id]?.before ? (winners[e.id].before as FundamentalSnapshot) : snapshotOf(e.profile)),
    [mode, winners],
  );
  const pattern = useMemo((): PatternMetric[] | null => (refs.length >= 2 ? buildPattern(refs.map(refSnapshot)) : null), [refs, refSnapshot]);

  const saveReferences = async (coins: PickedCoin[]) => {
    const added: string[] = [];
    for (const [i, c] of coins.entries()) {
      setBusy(`Analyzing ${c.name} and saving it to your library (${i + 1}/${coins.length})…`);
      try {
        await api("/api/library", { body: { id: c.id } });
        added.push(c.id);
      } catch (err) {
        setError(errMsg(err, `Failed to save ${c.name}`));
      }
    }
    setSelectedRefs((s) => [...new Set([...s, ...added])]);
    setReloadKey((k) => k + 1);
    setBusy(null);
  };

  const addReference = (coins: PickedCoin[]) => {
    const added = coins.find((c) => !library?.some((e) => e.id === c.id));
    if (added) saveReferences([added]);
  };

  /** The best 30-day performers among the top 250 (worth $50M+) become references. */
  const addTopPerformers = async () => {
    setBusy("Finding this month's top performers…");
    setError(null);
    try {
      const market = await api<MarketPulse>("/api/market");
      const have = new Set(library?.map((e) => e.id));
      const top = market.coins
        .filter((c) => c.id !== "bitcoin" && c.marketCap >= 50e6 && c.change.d30 !== null && !have.has(c.id))
        .sort((a, b) => (b.change.d30 as number) - (a.change.d30 as number))
        .slice(0, TOP_PERFORMERS);
      setNote(top.length ? `Top 30-day performers: ${top.map((c) => `${c.symbol} ${fmtPct(c.change.d30)}`).join(", ")}.` : "No new top performers to add.");
      await saveReferences(top.map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, thumb: c.image })));
    } catch (err) {
      setError(errMsg(err, "Couldn't load top performers"));
      setBusy(null);
    }
  };


  const resolvePaste = async () => {
    setBusy("Matching pasted coins…");
    setNote(null);
    try {
      const res = await api<{ resolved: { token: string; coin: PickedCoin }[]; unresolved: string[] }>(`/api/resolve?q=${encodeURIComponent(paste)}`);
      setCandidates((list) => {
        const next = [...list];
        for (const r of res.resolved) if (!next.some((c) => c.id === r.coin.id) && next.length < 20) next.push(r.coin);
        return next;
      });
      setPaste("");
      setNote(
        `Added ${res.resolved.map((r) => `${r.token} → ${r.coin.name}`).join(", ") || "nothing"}.` +
          (res.unresolved.length ? ` Not found: ${res.unresolved.join(", ")}.` : ""),
      );
    } catch (err) {
      setError(errMsg(err, "Couldn't match pasted coins"));
    } finally {
      setBusy(null);
    }
  };

  const check = async (coins: PickedCoin[] = candidates) => {
    setError(null);
    try {
      // Verdicts need narrative phases; the first load builds them (cached afterwards).
      setBusy("Loading narratives (the first time can take a few minutes)…");
      await api("/api/narratives").catch(() => null);
      setBusy(`Analyzing ${coins.length} coins (up to ~1 min for many coins)…`);
      const res = await fetchProfiles(coins);
      setProfiles(res.profiles);
      setError(profileErrors(res));
      const ids = res.profiles.map((p) => encodeURIComponent(p.id)).join(",");
      if (ids) setResearch((await api<{ research: Record<string, CoinResearch> }>(`/api/research?ids=${ids}`).catch(() => ({ research: {} }))).research);
    } catch (err) {
      setError(errMsg(err, "Check failed"));
    } finally {
      setBusy(null);
    }
  };

  // A list in the URL (?coins=SUI,ONDO&benchmarks=zcash) is loaded and checked right away, so research lists can be bookmarked.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const coins = params.get("coins");
    const benchmarks = (params.get("benchmarks") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!coins && !benchmarks.length) return;
    (async () => {
      if (benchmarks.length) {
        const saved = new Set((await api<{ entries: LibraryEntry[] }>("/api/library").catch(() => ({ entries: [] }))).entries.map((e) => e.id));
        for (const id of benchmarks.filter((b) => !saved.has(b))) await api("/api/library", { body: { id } }).catch(() => null);
        setSelectedRefs(benchmarks);
        setReloadKey((k) => k + 1);
      }
      if (coins) {
        const res = await api<{ resolved: { token: string; coin: PickedCoin }[] }>(`/api/resolve?q=${encodeURIComponent(coins)}`).catch(() => null);
        const picked = (res?.resolved ?? []).map((r) => r.coin).slice(0, 20);
        if (picked.length) {
          setCandidates(picked);
          await check(picked);
        }
      }
    })();
    // Runs once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo((): Row[] => {
    if (!profiles) return [];
    return profiles
      .map((cand) => {
        const snap = snapshotOf(cand);
        const results = refs.map((r) => compareCoins(refSnapshot(r), snap));
        const best = [...results].filter((r) => r.overall !== null).sort((a, b) => (b.overall as number) - (a.overall as number))[0];
        const ref = best ? refs.find((r) => r.id === best.referenceId) : undefined;
        const before = ref && mode === "before" && winners[ref.id]?.before;
        const match = best && ref ? { score: best.overall as number, reference: `${ref.name}${before ? " before its run" : " today"}` } : null;
        return { cand, results, pattern: pattern ? matchPattern(pattern, snap) : null, verdict: verdictFor(cand, { match, research: research[cand.id] }) };
      })
      .sort((a, b) => ORDER[a.verdict.kind] - ORDER[b.verdict.kind] || (b.verdict.fundamentals.score ?? -1) - (a.verdict.fundamentals.score ?? -1));
  }, [profiles, refs, research, refSnapshot, pattern, mode, winners]);

  const counts = { strong: 0, watch: 0, speculative: 0, avoid: 0 };
  for (const r of rows) counts[r.verdict.kind]++;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Coin Check"
        subtitle={
          <>
            Paste the coins you&apos;re researching. Each one gets a <b>fundamentals-first</b> verdict (usage, value capture, tokenomics, valuation,
            narrative stage; no technical analysis), and a comparison with benchmark coins that already performed well, showing where it&apos;s stronger
            and weaker.
          </>
        }
      />

      <Card>
        <SectionTitle
          title="1. Coins to check"
          right={
            <Button onClick={() => check()} disabled={!candidates.length || busy !== null}>
              Check {candidates.length || ""} coin{candidates.length === 1 ? "" : "s"}
            </Button>
          }
        />
        <div className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              rows={2}
              placeholder="Paste tickers or names, separated by commas or new lines: SUI, RENDER, ONDO, Jupiter…"
              className="flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-subtle focus:border-brand"
            />
            <Button variant="ghost" onClick={resolvePaste} disabled={!paste.trim() || busy !== null}>
              Add pasted coins
            </Button>
          </div>
          <CoinPicker value={candidates} onChange={setCandidates} placeholder="…or search and add one at a time" max={20} />
          {note && <p className="text-sm text-muted">{note}</p>}
        </div>
      </Card>

      <Card>
        <SectionTitle
          title="2. Benchmarks (optional)"
          subtitle={
            <>
              Coins that already performed well, like ZEC for privacy. Saved in your <Link href="/library" className="text-up hover:underline">Library</Link>. By default
              each is compared as it was the day its run began, which is what a candidate should look like now.
            </>
          }
          right={
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={addTopPerformers} disabled={busy !== null || !library}>
                + Add this month&apos;s top {TOP_PERFORMERS} performers
              </Button>
              <div className="inline-flex rounded-md border border-line p-0.5 text-xs">
                {(["before", "today"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`rounded px-2.5 py-1 ${mode === m ? "bg-surface-3 text-fg" : "text-muted hover:text-fg"}`}
                    title={m === "before" ? "Compare with each winner's fundamentals the day its run began" : "Compare with each winner as it is today, after its move"}
                  >
                    {m === "before" ? "Winner before its run" : "Winner today"}
                  </button>
                ))}
              </div>
            </div>
          }
        />
        {!library ? (
          <Spinner label="Loading library…" />
        ) : (
          <div className="space-y-3">
            {library.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {library.map((e) => {
                  const on = selectedRefs.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => setSelectedRefs((s) => (on ? s.filter((x) => x !== e.id) : [...s, e.id]))}
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
            )}
            <CoinPicker value={NO_COINS} onChange={addReference} placeholder="Add a benchmark by name, e.g. Zcash (it gets analyzed and saved)…" />
            {mode === "before" && refs.length > 0 && <RunList refs={refs} winners={winners} />}
          </div>
        )}
      </Card>

      {pattern && pattern.length > 0 && <PatternCard pattern={pattern} mode={mode} count={refs.length} />}

      {busy && <Spinner label={busy} />}
      {error && <ErrorBox message={error} />}

      {rows.length > 0 && (
        <Card className="overflow-hidden p-0">
          <div className="space-y-1 p-4 pb-2">
            <SectionTitle
              title="3. Verdicts"
              subtitle={
                <>
                  {counts.strong} strong candidate{counts.strong === 1 ? "" : "s"}, {counts.watch} for the watchlist, {counts.speculative} speculative, {counts.avoid} to
                  avoid. Click a row for the reasons{refs.length ? ", or a percentage for the benchmark comparison" : ""}.
                </>
              }
            />
            <Evidence backtest={backtest} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
                <tr className="border-b border-line">
                  <th className="px-4 py-2">Coin</th>
                  <th className="px-3 py-2">Verdict</th>
                  <th className="px-3 py-2">Narrative</th>
                  <th className="px-3 py-2" title="Fundamental score out of 100, from the eight-category scorecard">
                    Fundamentals
                  </th>
                  <th className="px-3 py-2 text-right" title="Share of the scorecard backed by data or your ratings">
                    Evidence
                  </th>
                  <th className="px-3 py-2 text-right">Risk</th>
                  {pattern && (
                    <th className="px-3 py-2 text-center" title="How well it sits inside the winners' ranges (see the pattern card)">
                      Pattern
                    </th>
                  )}
                  {refs.map((r) => (
                    <th key={r.id} className="px-3 py-2 text-center font-medium">
                      vs {r.symbol}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular">
                {rows.map(({ cand, results, pattern: pm, verdict }) => {
                  const rowOpen = open?.cand === cand.id;
                  const toggle = (ref: string | null) => setOpen(rowOpen && open?.ref === ref ? null : { cand: cand.id, ref });
                  return (
                    <Fragment key={cand.id}>
                      <tr onClick={() => toggle(null)} className={`cursor-pointer border-b border-line hover:bg-surface-2 ${rowOpen ? "bg-surface-2" : ""}`}>
                        <td className="px-4 py-2.5">
                          <Link href={`/coin/${cand.id}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-2 hover:text-brand-strong">
                            <CoinIcon src={cand.image} alt={cand.name} />
                            <span className="text-fg">{cand.name}</span>
                            <span className="text-subtle">{cand.symbol}</span>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={verdict.tone}>{verdict.label}</Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <CoinNarrativeChip narrative={cand.narrative} loaded={cand.narrativeLoaded} />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <ScoreBar score={verdict.fundamentals.score} width="w-14" />
                            <span className={`text-sm font-semibold ${scoreText(verdict.fundamentals.score)}`}>{verdict.fundamentals.score ?? "–"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right text-muted">{fmtPct(verdict.fundamentals.confidence, { signed: false, digits: 0 })}</td>
                        <td className={`px-3 py-2.5 text-right ${scoreText(cand.scores.risk.score, true)}`}>{cand.scores.risk.score ?? "–"}</td>
                        {pattern && (
                          <td className="px-2 py-1.5 text-center">
                            <span className={`inline-block w-full rounded-md px-2 py-1 font-semibold ${cellColor(pm?.score ?? null)}`}>{pm?.score == null ? "—" : `${pm.score}%`}</span>
                          </td>
                        )}
                        {results.map((res) => {
                          const isOpen = rowOpen && open?.ref === res.referenceId;
                          return (
                            <td key={res.referenceId} className="px-2 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggle(res.referenceId);
                                }}
                                title={similarityLabel(res.overall).label}
                                className={`w-full rounded-md px-2 py-1 font-semibold ${cellColor(res.overall)} ${isOpen ? "ring-1 ring-brand" : ""}`}
                              >
                                {res.overall === null ? "—" : `${res.overall}%`}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                      {rowOpen && (
                        <tr className="border-b border-line">
                          <td colSpan={refs.length + 6 + (pattern ? 1 : 0)} className="bg-surface-2 px-4 py-4">
                            {open?.ref ? (
                              <Breakdown
                                result={results.find((r) => r.referenceId === open.ref) as SimilarityResult}
                                refName={refs.find((r) => r.id === open.ref)?.name ?? ""}
                                candName={cand.name}
                              />
                            ) : (
                              <div className="space-y-4">
                                <VerdictPanel verdict={verdict} />
                                {pm && <PatternDetail match={pm} />}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-3 text-sm text-subtle">
            Benchmark % = weighted fundamental similarity ({GROUPS.map((g) => `${g.label} ${g.weight}%`).join(", ")}). Open a coin&apos;s page to add your own
            research (use case, moat, team), which feeds its score. A verdict is a research screen, not advice: unlock schedules and holder concentration
            aren&apos;t covered (paid data).
          </p>
        </Card>
      )}
    </div>
  );
}

/** One line from the latest backtest, so verdicts come with a track record. */
function Evidence({ backtest }: { backtest: StrategyBacktestResult | null }) {
  if (!backtest) {
    return (
      <p className="text-sm text-muted">
        These rules haven&apos;t been backtested yet. <Link href="/backtest" className="text-up hover:underline">Run a backtest</Link> to see how fundamental scores
        like these did in the past.
      </p>
    );
  }
  const { signals, baseline, edge, options } = backtest;
  return (
    <p className="text-sm text-muted">
      Track record: since {backtest.period.from.slice(0, 4)}, coins with a fundamental score of {options.threshold}+ averaged {fmtPct(signals.avgReturn)} over{" "}
      {options.horizonDays} days after costs, vs {fmtPct(baseline.avgReturn)} for all coins
      {edge.low !== null && edge.high !== null ? ` (edge 90% range ${fmtPct(edge.low)} to ${fmtPct(edge.high)})` : ""}.{" "}
      <Link href="/backtest" className="text-up hover:underline">
        Details
      </Link>
    </p>
  );
}

function Breakdown({ result, refName, candName }: { result: SimilarityResult; refName: string; candName: string }) {
  const missing = result.missing;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h4 className="text-base font-bold text-fg">
          {candName} vs {refName}: {result.overall ?? "—"}% similar
        </h4>
        <span className="text-xs text-subtle">Data coverage {fmtPct(result.coverage, { signed: false, digits: 0 })}</span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <EdgeList title={`Where ${candName} is stronger`} items={result.stronger} mark="▲" tone="text-up" />
        <EdgeList title={`Where ${candName} is weaker`} items={result.weaker} mark="▼" tone="text-down" />
      </div>
      {missing.length > 0 && (
        <p className="text-sm text-muted">
          <b className="text-fg-2">Not compared (missing data):</b> {missing.join("; ")}.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {result.groups.map((g) => (
          <div key={g.key} className="rounded-lg border border-line p-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-fg-2">
                {g.score === null ? "○" : g.score >= 60 ? "✓" : "✕"} {g.label}
              </span>
              <span className="tabular font-semibold text-fg">{g.score === null ? "—" : `${g.score}%`}</span>
            </div>
            <div className="mt-1.5">
              <ScoreBar score={g.score} />
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {result.groups.map((g) => (
          <table key={g.key} className="tabular w-full self-start text-sm">
            <thead className="whitespace-nowrap text-xs font-bold text-fg">
              <tr>
                <th className="py-1 text-left">{g.label}</th>
                <th className="py-1 text-right">{refName}</th>
                <th className="py-1 text-right">{candName}</th>
                <th className="py-1 text-right">Match</th>
              </tr>
            </thead>
            <tbody>
              {g.features.map((f) => (
                <tr key={f.label} className={`border-t border-line ${f.similarity === null ? "opacity-50" : ""}`}>
                  <td className="py-1 text-muted">{f.label}</td>
                  <td className="py-1 text-right text-fg-2">{f.reference}</td>
                  <td className="py-1 text-right text-fg-2">{f.candidate}</td>
                  <td className={`py-1 text-right font-medium ${f.similarity === null ? "text-faint" : f.similarity >= 60 ? "text-up" : f.similarity >= 40 ? "text-warn" : "text-down"}`}>
                    {f.edge && <span className={`mr-1 text-xs ${f.edge === "stronger" ? "text-up" : "text-down"}`}>{f.edge === "stronger" ? "▲" : "▼"}</span>}
                    {f.similarity === null ? "—" : `${f.similarity}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </div>
  );
}

function EdgeList({ title, items, mark, tone }: { title: string; items: string[]; mark: string; tone: string }) {
  return (
    <div>
      <h5 className="text-sm font-bold text-fg">{title}</h5>
      <ul className="mt-1 space-y-0.5 text-sm text-fg-2">
        {items.length ? (
          items.map((x) => (
            <li key={x}>
              <span className={`mr-1.5 text-xs ${tone}`}>{mark}</span>
              {x}
            </li>
          ))
        ) : (
          <li className="text-muted">Nothing clear.</li>
        )}
      </ul>
    </div>
  );
}

/** How each benchmark is compared: its run, and the day its fundamentals are taken from. */
function RunList({ refs, winners }: { refs: LibraryEntry[]; winners: Record<string, PreMove> }) {
  const describe = (w: PreMove) => {
    const asOf = w.before?.asOf;
    if (!asOf) return w.note ?? "compared as it is today.";
    const when = `${fmtDate(asOf)} ${asOf.slice(0, 4)}`;
    const run = w.run ? `+${Math.round(w.run.gain * 100)}% from ${fmtDate(w.run.lowDate)} ${w.run.lowDate.slice(0, 4)} to ${fmtDate(w.run.peakDate)} ${w.run.peakDate.slice(0, 4)}` : null;
    if (w.custom) return `compared as of ${when}, your chosen date${run ? ` (before its run of ${run})` : ""}.`;
    return `${run}; compared as of ${when}, the day before its breakout.`;
  };
  return (
    <div className="space-y-1">
      <ul className="space-y-1 text-sm text-muted">
        {refs.map((r) => {
          const w = winners[r.id];
          return (
            <li key={r.id}>
              <b className="text-fg-2">{r.symbol}</b>: {w ? describe(w) : "finding its run…"}
              {w?.before && w.note && <span className="text-subtle"> {w.note}</span>}
              {w?.before?.approx?.map((a) => (
                <span key={a} className="block text-xs text-warn">
                  {a}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
      <Link href="/winners" className="text-sm text-up hover:underline">
        Pick a different run or date on the Winners page →
      </Link>
    </div>
  );
}

/** What the selected winners had in common (before their runs, by default). */
function PatternCard({ pattern, mode, count }: { pattern: PatternMetric[]; mode: Mode; count: number }) {
  return (
    <Card>
      <SectionTitle
        title="Winner pattern"
        subtitle={`What your ${count} benchmarks had in common ${mode === "before" ? "the day before their runs began" : "today"}. The Pattern column shows how well each coin fits these ranges.`}
      />
      {pattern.every((m) => m.tooWide) ? (
        <p className="mb-2 text-sm text-warn">These winners have too little in common for a pattern. Pick 3+ winners from the same narrative for a sharper one.</p>
      ) : (
        count < 3 && <p className="mb-2 text-sm text-muted">With only {count} winners the ranges are wide. 3+ winners from the same narrative give a sharper pattern.</p>
      )}
      <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {pattern.map((m) => (
          <div
            key={m.key}
            className={`flex justify-between gap-3 border-b border-line py-1 ${m.tooWide ? "opacity-50" : ""}`}
            title={m.tooWide ? "The winners differ too much here for it to tell anything; left out of the match." : undefined}
          >
            <span className="text-muted">
              {m.label}
              {m.tooWide && <span className="ml-1 text-xs">(too wide to tell)</span>}
            </span>
            <span className="tabular text-right text-fg-2">
              {m.display}
              <span className="ml-1 text-xs text-subtle">
                ({m.count}/{count})
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function PatternDetail({ match }: { match: PatternMatch }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <EdgeList title="Inside the winner pattern" items={match.inside} mark="✓" tone="text-up" />
      <EdgeList title="Outside it" items={match.outside} mark="✕" tone="text-down" />
      {match.missing.length > 0 && <p className="text-sm text-muted md:col-span-2">No data for: {match.missing.join(", ")}.</p>}
    </div>
  );
}
