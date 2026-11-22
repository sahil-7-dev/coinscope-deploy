"use client";

import { Fragment, useState } from "react";
import type { AssetAbout, CoinProfile, CoinResearch, DevActivity, Fundamentals, Governance, Peer, ThesisEvent } from "@/lib/types";
import { thesisStatus } from "@/lib/analysis/thesis";
import { EvidenceRow, ThesisEditor, ThesisHistory } from "./ThesisPanel";
import type { Evidence, FundamentalScore } from "@/lib/analysis/fundamentals";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtPct, fmtUsd, fmtX } from "@/lib/format";
import { Badge, Button, ErrorBox, Pct } from "./ui";
import { ScoreBar } from "./ScoresPanel";

const EVIDENCE: Record<Evidence, { label: string; tone: "good" | "neutral" | "warn" | "bad" }> = {
  data: { label: "Data", tone: "good" },
  you: { label: "Your rating", tone: "good" },
  "data + you": { label: "Data + you", tone: "good" },
  fallback: { label: "No data", tone: "warn" },
  none: { label: "Missing", tone: "neutral" },
};

/** The eight-category scorecard with every metric behind it. */
export function Scorecard({ fa }: { fa: FundamentalScore }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <div className="text-xs text-muted">Fundamental score</div>
          <div className="tabular text-4xl font-bold text-fg">
            {fa.score ?? "–"}
            <span className="text-base text-subtle">/100</span>
          </div>
        </div>
        <Badge tone={fa.tone}>{fa.label}</Badge>
        <div className="text-sm text-muted">
          Evidence confidence <b className="text-fg">{fmtPct(fa.confidence, { signed: false, digits: 0 })}</b>
          <span className="text-subtle"> of the weight is backed by data or your ratings</span>
          {fa.rawScore !== null && fa.rawScore !== fa.score && (
            <div className="text-xs text-subtle">
              {fa.rawScore} from the categories with data, pulled toward 45 for the missing evidence: gaps can lower a score, never raise it.
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[620px] text-sm">
          <thead className="bg-surface-2 text-left whitespace-nowrap text-xs font-bold text-fg">
            <tr>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2 text-right">Weight</th>
              <th className="px-3 py-2">Score</th>
              <th className="px-3 py-2">Based on</th>
            </tr>
          </thead>
          <tbody>
            {fa.categories.map((c) => {
              const isOpen = open === c.key;
              return (
                <Fragment key={c.key}>
                  <tr onClick={() => setOpen(isOpen ? null : c.key)} className="cursor-pointer border-t border-line hover:bg-surface-2">
                    <td className="px-3 py-2 text-fg">
                      {isOpen ? "▾" : "▸"} {c.label}
                    </td>
                    <td className="tabular px-3 py-2 text-right text-subtle">{c.weight}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <ScoreBar score={c.score} width="w-24" />
                        <span className="tabular w-7 text-xs text-muted">{c.score ?? "–"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={EVIDENCE[c.evidence].tone}>{EVIDENCE[c.evidence].label}</Badge>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-line bg-surface-2">
                      <td colSpan={4} className="px-5 py-3">
                        <p className="mb-2 text-xs text-subtle">{c.why}</p>
                        <table className="tabular w-full text-sm">
                          <tbody>
                            {c.metrics.map((m) => (
                              <tr key={m.label} className={m.score === null ? "opacity-50" : ""}>
                                <td className="py-1 text-muted">{m.label}</td>
                                <td className="py-1 text-right text-fg-2">{m.display}</td>
                                <td className="w-28 py-1 pl-3">
                                  <ScoreBar score={m.score} width="w-20" />
                                </td>
                                <td className="w-8 py-1 text-right text-xs text-muted">{m.score ?? "–"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ProsCons title="Strengths" items={fa.strengths} mark="✓" tone="text-up" empty="Nothing stands out yet." />
        <ProsCons title="Weaknesses" items={fa.weaknesses} mark="✕" tone="text-down" empty="No clear weak spots in the data." />
      </div>
    </div>
  );
}

function ProsCons({ title, items, mark, tone, empty }: { title: string; items: string[]; mark: string; tone: string; empty: string }) {
  return (
    <div>
      <h4 className="text-sm font-bold text-fg">{title}</h4>
      <ul className="mt-1 space-y-1 text-sm text-fg-2">
        {items.length ? (
          items.map((s) => (
            <li key={s} className="flex gap-2">
              <span className={`font-bold ${tone}`}>{mark}</span>
              {s}
            </li>
          ))
        ) : (
          <li className="text-muted">{empty}</li>
        )}
      </ul>
    </div>
  );
}

// ---- Identity: what the project is ----

export function AboutPanel({
  about,
  f,
  categories,
  dev,
  gov,
}: {
  about: AssetAbout | null | undefined;
  f: Fundamentals | null;
  categories: string[];
  dev?: DevActivity | null;
  gov?: Governance | null;
}) {
  const [more, setMore] = useState(false);
  const text = about?.description ?? "";
  const short = text.length > 600 && !more ? `${text.slice(0, 600).trim()}…` : text;
  const links = [
    about?.homepage && { href: about.homepage, label: "Website" },
    about?.whitepaper && { href: about.whitepaper, label: "Whitepaper" },
    about?.github && { href: about.github, label: "GitHub" },
    about?.twitter && { href: `https://x.com/${about.twitter}`, label: `@${about.twitter}` },
  ].filter(Boolean) as { href: string; label: string }[];
  const facts: [string, string][] = [];
  if (f?.category) facts.push(["DefiLlama category", f.category]);
  if (f?.categoryRank) facts.push(["Rank by fees in category", `#${f.categoryRank} of ${f.categoryPeers}`]);
  if (f?.audits != null && f.kind === "protocol") facts.push(["Audits", String(f.audits)]);
  if (f?.hacks && f.kind === "protocol") facts.push(["Hacks on record", f.hacks.count ? `${f.hacks.count} (${fmtUsd(f.hacks.lostUsd)} lost, last ${f.hacks.last ? fmtDate(f.hacks.last) + " " + f.hacks.last.slice(0, 4) : "?"})` : "None"]);
  if (f?.listedAt) facts.push(["Tracked by DefiLlama since", f.listedAt.slice(0, 7)]);
  if (f?.stablecoins) facts.push(["Stablecoins on chain", `${fmtUsd(f.stablecoins.current)} (${fmtPct(f.stablecoins.change30d)} 30d)`]);
  if (f?.launches) facts.push(["New protocols on chain (90d)", `${f.launches.last90} (prior 90d: ${f.launches.prev90})`]);
  if (dev) {
    const trend = dev.commitsPrev12w > 0 ? ` (${fmtPct(dev.commits12w / dev.commitsPrev12w - 1)} vs prior 12w)` : "";
    facts.push(["GitHub commits (12 weeks)", `${dev.commits12w}${trend}`]);
    facts.push(["Active weeks / contributors", `${dev.activeWeeks12} of 12 · ${dev.contributors ?? "?"} contributors`]);
  }
  if (gov) {
    facts.push([
      "Governance (Snapshot)",
      `${gov.proposals90d} proposals in 90d${gov.avgVotes ? `, ~${gov.avgVotes} votes each` : ""}${gov.lastProposal ? `, last ${fmtDate(gov.lastProposal)}` : ""}`,
    ]);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
      <div>
        {text ? (
          <p className="text-sm whitespace-pre-line text-fg-2">
            {short}
            {text.length > 600 && (
              <button type="button" onClick={() => setMore(!more)} className="ml-1 text-up hover:underline">
                {more ? "less" : "more"}
              </button>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted">No description on CoinGecko.</p>
        )}
        {(links.length > 0 || dev || gov) && (
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {links.map((l) => (
              <a key={l.href} href={l.href} target="_blank" rel="noreferrer" className="text-up hover:underline">
                {l.label} ↗
              </a>
            ))}
            {dev && !about?.github?.includes(dev.repo) && (
              <a href={`https://github.com/${dev.repo}`} target="_blank" rel="noreferrer" className="text-up hover:underline">
                {dev.repo} ↗
              </a>
            )}
            {gov && (
              <a href={`https://snapshot.box/#/s:${gov.space}`} target="_blank" rel="noreferrer" className="text-up hover:underline">
                Governance ↗
              </a>
            )}
          </div>
        )}
      </div>
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap gap-1.5">
          {categories.slice(0, 8).map((c) => (
            <Badge key={c}>{c}</Badge>
          ))}
        </div>
        <table className="w-full">
          <tbody>
            {facts.map(([k, v]) => (
              <tr key={k} className="border-t border-line">
                <td className="py-1 text-muted">{k}</td>
                <td className="py-1 text-right text-fg-2">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---- Your research: the judgment calls data can't make ----

export const EMPTY_RESEARCH: CoinResearch = {
  ratings: { useCase: null, moat: null, team: null, ambition: null, feasibility: null },
  notes: { problem: "", unique: "", tokenValue: "", competitors: "", bull: "", base: "", bear: "", catalysts: "", invalidation: "" },
  thesis: { stance: null, summary: "", assumptions: [], reviewOn: null },
  evidence: {},
  updatedAt: null,
};

const RATING_FIELDS: { key: keyof CoinResearch["ratings"]; label: string; hint: string; scored: boolean }[] = [
  { key: "useCase", label: "Use case & problem", hint: "Real problem? Needs a blockchain and its own token?", scored: true },
  { key: "moat", label: "Technology & moat", hint: "Hard to copy? Better than competitors?", scored: true },
  { key: "team", label: "Team & execution", hint: "Do they ship? Track record?", scored: true },
  { key: "ambition", label: "Ambition", hint: "How big is the outcome if it works?", scored: false },
  { key: "feasibility", label: "Feasibility", hint: "Is the product built? Is the roadmap realistic?", scored: false },
];

/** The use-case questions come first: why it exists, why it's hard to copy, why the token captures value. */
const NOTE_FIELDS: { key: keyof CoinResearch["notes"]; label: string; placeholder: string }[] = [
  { key: "problem", label: "Why it exists", placeholder: "What problem does it solve? Why does that need a blockchain, and its own token?" },
  { key: "unique", label: "Why it's hard to copy", placeholder: "Technology, network effects, liquidity, brand, licenses… What can't a competitor easily replicate?" },
  { key: "tokenValue", label: "Why the token captures value", placeholder: "Fee share, buybacks or burns, staking, collateral, governance with real power… or nothing?" },
  { key: "competitors", label: "Versus competitors", placeholder: "Who it competes with (see the table above) and where it wins or loses…" },
  { key: "catalysts", label: "Catalysts", placeholder: "Upgrades, launches, regulation, integrations coming up…" },
  { key: "bull", label: "Bull case", placeholder: "What happens if everything goes right, and what has to happen first…" },
  { key: "base", label: "Base case", placeholder: "The most likely outcome…" },
  { key: "bear", label: "Bear case", placeholder: "What goes wrong…" },
  { key: "invalidation", label: "Thesis breaks if…", placeholder: "Fees fall for two quarters, the main competitor wins, a key unlock…" },
];

export function ResearchPanel({
  profile,
  research,
  events,
  onSaved,
}: {
  profile: CoinProfile;
  research: CoinResearch;
  events: ThesisEvent[];
  onSaved: (r: CoinResearch) => void;
}) {
  const [draft, setDraft] = useState<CoinResearch>(research);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const strip = (r: CoinResearch) => JSON.stringify({ ...r, updatedAt: null });
  const dirty = strip(draft) !== strip(research);
  const saved = thesisStatus(research, profile);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api<CoinResearch>("/api/research", { method: "PUT", body: { id: profile.id, research: draft } }));
    } catch (err) {
      setError(errMsg(err, "Couldn't save"));
    } finally {
      setBusy(false);
    }
  };

  const ambition = draft.ratings.ambition;
  const feasibility = draft.ratings.feasibility;

  return (
    <div className="space-y-5">
      {(saved.broken.length > 0 || saved.reviewDue) && (
        <div className="rounded-xl border border-down/30 bg-down/5 px-3 py-2 text-sm text-fg">
          {saved.broken.map((b) => (
            <div key={b.assumption.id}>
              <b className="text-down">Assumption broken:</b> {b.assumption.text || b.rule} ({b.rule}; now {b.current}).
            </div>
          ))}
          {saved.reviewDue && (
            <div>
              <b className="text-warn">Review due:</b> you planned to re-check this research on {research.thesis.reviewOn}.
            </div>
          )}
        </div>
      )}

      <section>
        <h3 className="mb-2 text-base font-bold text-fg">Thesis</h3>
        <ThesisEditor thesis={draft.thesis} onChange={(thesis) => setDraft({ ...draft, thesis })} profile={profile} research={draft} />
      </section>

      <h3 className="text-base font-bold text-fg">Ratings and notes</h3>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {RATING_FIELDS.map((f) => (
          <label key={f.key} className="rounded-xl border border-line p-3 text-sm">
            <div className="font-semibold text-fg">{f.label}</div>
            <div className="mb-2 text-xs text-subtle">
              {f.hint}
              {f.scored ? " Counts in the score." : ""}
            </div>
            <select
              value={draft.ratings[f.key] ?? ""}
              onChange={(e) => setDraft({ ...draft, ratings: { ...draft.ratings, [f.key]: e.target.value ? Number(e.target.value) : null } })}
              className="w-full rounded border border-line bg-surface px-2 py-1 text-fg"
            >
              <option value="">Not rated</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}/10
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {ambition !== null && feasibility !== null && (
        <p className="text-sm text-fg-2">
          Ambition {ambition}/10 vs feasibility {feasibility}/10:{" "}
          <b>
            {ambition >= 7 && feasibility <= 4
              ? "a high-risk moonshot"
              : ambition >= 7 && feasibility >= 7
                ? "a big, credible thesis"
                : feasibility >= 7
                  ? "a credible but smaller thesis"
                  : "an uncertain thesis"}
          </b>
          .
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {NOTE_FIELDS.map((f) => (
          <label key={f.key} className="text-sm">
            <span className="font-semibold text-fg">{f.label}</span>
            <textarea
              value={draft.notes[f.key]}
              onChange={(e) => setDraft({ ...draft, notes: { ...draft.notes, [f.key]: e.target.value } })}
              rows={3}
              placeholder={f.placeholder}
              className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-subtle focus:border-brand"
            />
            <EvidenceRow tag={draft.evidence[f.key]} onChange={(tag) => setDraft({ ...draft, evidence: { ...draft.evidence, [f.key]: tag } })} />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save research"}
        </Button>
        {research.updatedAt && <span className="text-xs text-subtle">Last saved {new Date(research.updatedAt).toLocaleString()}</span>}
        {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
      </div>
      {error && <ErrorBox message={error} />}

      <section>
        <h3 className="mb-2 text-base font-bold text-fg">History</h3>
        <ThesisHistory events={events} />
      </section>
    </div>
  );
}

// ---- Competitors: the biggest fee earners in its DefiLlama category ----

export function CompetitorsTable({ f }: { f: Fundamentals | null }) {
  const peers: Peer[] = f?.peers ?? [];
  if (!peers.length) {
    return <p className="text-sm text-muted">No fee-earning peers on DefiLlama for this coin, so there&apos;s no data-backed competitor list.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="tabular w-full min-w-[560px] text-sm">
        <thead className="text-left whitespace-nowrap text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="py-1.5 pr-3">{f?.category ?? "Category"}</th>
            <th className="px-2 py-1.5 text-right">Fees 30d</th>
            <th className="px-2 py-1.5 text-right">Growth 30d</th>
            <th className="px-2 py-1.5 text-right">Share</th>
            <th className="px-2 py-1.5 text-right">Market cap</th>
            <th className="py-1.5 pl-2 text-right" title="Market cap ÷ annualized fees: lower = cheaper for its usage">
              P/F
            </th>
          </tr>
        </thead>
        <tbody>
          {peers.map((p) => (
            <tr key={p.name} className={`border-b border-line ${p.isSelf ? "bg-up/5 font-semibold" : ""}`}>
              <td className="py-1.5 pr-3 text-fg">
                {p.name}
                {p.isSelf && <span className="ml-1.5 text-xs text-up">this coin</span>}
              </td>
              <td className="px-2 py-1.5 text-right text-fg-2">{fmtUsd(p.fees30d)}</td>
              <td className="px-2 py-1.5 text-right">
                <Pct value={p.feesGrowth30d} />
              </td>
              <td className="px-2 py-1.5 text-right text-muted">{fmtPct(p.share, { signed: false, digits: 0 })}</td>
              <td className="px-2 py-1.5 text-right text-muted">{fmtUsd(p.marketCap)}</td>
              <td className="py-1.5 pl-2 text-right text-muted">{fmtX(p.priceToFees)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-subtle">Top fee earners in the same DefiLlama category. Market cap is missing for peers without a token.</p>
    </div>
  );
}
