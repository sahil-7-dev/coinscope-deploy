"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import type { DecisionAction, DecisionResult, JournalGroup, JournalResponse, PickedCoin, Tone } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtPct, fmtPrice } from "@/lib/format";
import { Badge, Button, Card, CoinIcon, ErrorBox, PageHeader, Pct, SectionTitle, Spinner, Tabs } from "@/components/ui";
import { CoinPicker } from "@/components/CoinPicker";
import { StageBadge } from "@/components/NarrativeBadge";

const VERDICT_TONE: Record<NonNullable<DecisionResult["verdict"]>, Tone> = { strong: "good", watch: "neutral", speculative: "warn", avoid: "bad" };
const share = (x: number | null) => fmtPct(x, { signed: false, digits: 0 });
const inputCls = "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg";

export default function JournalPage() {
  const [data, setData] = useState<JournalResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<JournalResponse>("/api/journal")
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load the journal")));
    return () => {
      cancelled = true;
    };
  }, [reload]);

  const refresh = () => setReload((k) => k + 1);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal"
        subtitle="Is your process working? Log every buy and every pass. The app records what it said at that moment (verdict, score, narrative stage, your thesis); once a decision is 30 days old it's judged against BTC. Your passes count too: if they keep beating BTC, you're being too strict."
      />
      <Suspense fallback={null}>
        <AddDecision onAdded={refresh} />
      </Suspense>
      {error && <ErrorBox message={error} />}
      {!data && !error && <Spinner label="Loading your decisions…" />}
      {data && data.decisions.length > 0 && <Summary data={data} />}
      {data && <Decisions data={data} onChange={refresh} />}
    </div>
  );
}

function AddDecision({ onAdded }: { onAdded: () => void }) {
  // "Log decision" on a coin links here with the coin in the URL.
  const q = useSearchParams();
  const linked = q.get("coin");
  const [coin, setCoin] = useState<PickedCoin[]>(
    linked ? [{ id: linked, name: q.get("name") ?? linked, symbol: q.get("symbol") ?? linked, thumb: q.get("thumb") ?? undefined }] : [],
  );
  const [action, setAction] = useState<DecisionAction>("buy");
  const [date, setDate] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (!coin[0]) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/journal", { body: { coinId: coin[0].id, action, decidedOn: date || undefined, price: price ? Number(price) : null, note } });
      setCoin([]);
      setDate("");
      setPrice("");
      setNote("");
      window.history.replaceState(null, "", "/journal");
      onAdded();
    } catch (err) {
      setError(errMsg(err, "Couldn't log the decision"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle title="Log a decision" subtitle="Log it the day you decide: the app's verdict is recorded as it is right now. Backdated entries are kept but left out of the verdict check." />
      <div className="grid gap-3 lg:grid-cols-[2fr_auto_auto_auto]">
        <CoinPicker value={coin} onChange={setCoin} max={1} placeholder="Coin, e.g. Hyperliquid" />
        <Tabs
          options={[
            { value: "buy" as const, label: "Buy" },
            { value: "pass" as const, label: "Pass" },
          ]}
          value={action}
          onChange={setAction}
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          Date
          <input type="date" value={date} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} className={inputCls} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          Price
          <input type="number" min="0" step="any" value={price} placeholder="auto" onChange={(e) => setPrice(e.target.value)} className={`${inputCls} w-28`} />
        </label>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder={action === "buy" ? "Why are you buying? What would make you sell?" : "Why are you passing? What would change your mind?"}
        className={`${inputCls} mt-3 w-full`}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!coin[0] || busy}>
          {busy ? "Analyzing and saving…" : `Log ${action}`}
        </Button>
        <span className="text-xs text-subtle">Leave date and price empty for today at the live price. Older dates use CoinGecko&apos;s daily close (last year only).</span>
        {error && <span className="text-sm text-down">{error}</span>}
      </div>
    </Card>
  );
}

function GroupTile({ g, hint }: { g: JournalGroup; hint: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted">{g.label}</div>
      <div className="tabular mt-1 text-xl font-bold text-fg">{g.decisions ? <Pct value={g.vsBtc} /> : "—"}</div>
      <div className="mt-1 text-sm text-muted">{g.decisions ? `${share(g.beatBtc)} beat BTC · ${g.decisions} counted` : "Nothing counted yet"}</div>
      <div className="mt-1 text-xs text-subtle">{hint}</div>
    </Card>
  );
}

function GroupTable({ title, subtitle, rows, label }: { title: string; subtitle: string; rows: JournalGroup[]; label: (g: JournalGroup) => React.ReactNode }) {
  return (
    <Card>
      <SectionTitle title={title} subtitle={subtitle} />
      <table className="tabular w-full text-sm">
        <thead className="text-left text-xs font-bold text-fg">
          <tr className="border-b border-line">
            <th className="py-1.5" />
            <th className="py-1.5 text-right">Counted</th>
            <th className="py-1.5 text-right">Median vs BTC</th>
            <th className="py-1.5 text-right">Beat BTC</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.label} className="border-b border-line">
              <td className="py-1.5">{label(g)}</td>
              <td className="py-1.5 text-right text-fg-2">{g.decisions}</td>
              <td className="py-1.5 text-right">
                <Pct value={g.vsBtc} />
              </td>
              <td className="py-1.5 text-right text-fg-2">{share(g.beatBtc)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function Summary({ data }: { data: JournalResponse }) {
  const s = data.summary;
  const counted = data.decisions.filter((d) => d.counted).length;
  return (
    <div className="space-y-4">
      {counted === 0 ? (
        <p className="text-sm text-muted">
          Results appear once a decision is {data.minDays} days old. {s.tooEarly} {s.tooEarly === 1 ? "decision is" : "decisions are"} waiting.
        </p>
      ) : (
        <p className="text-sm text-muted">
          {counted} {counted === 1 ? "decision" : "decisions"} at least {data.minDays} days old are counted
          {s.tooEarly ? `; ${s.tooEarly} newer ${s.tooEarly === 1 ? "one is" : "ones are"} still waiting` : ""}. Medians, so one big winner can&apos;t carry the result. A
          handful of decisions is anecdote, not evidence: give it 20+.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <GroupTile g={s.buys} hint="Above 0% and beating BTC more than half the time: your buys are adding value." />
        <GroupTile g={s.passes} hint="Here lower is better: passes that beat BTC are ones you missed." />
        <GroupTile g={s.against} hint="Buys the app called Speculative or Avoid, and passes on a Strong candidate." />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <GroupTable
          title="Was the app right?"
          subtitle="Every decision (buys and passes) by the verdict the app gave on the day. Strong candidates should do best."
          rows={s.byVerdict}
          label={(g) => g.label}
        />
        <GroupTable
          title="By narrative stage at the time"
          subtitle="The coin's strongest narrative stage when you decided."
          rows={s.byStage}
          label={(g) => (g.label === "No tracked narrative" ? <span className="text-muted">{g.label}</span> : <StageBadge stage={g.label as DecisionResult["stage"]} />)}
        />
      </div>
    </div>
  );
}

function Decisions({ data, onChange }: { data: JournalResponse; onChange: () => void }) {
  const [selling, setSelling] = useState<number | null>(null);
  const [sellDate, setSellDate] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      setSelling(null);
      onChange();
    } catch (err) {
      setError(errMsg(err, "That didn't work"));
    }
  };

  if (!data.decisions.length) return <p className="text-sm text-muted">No decisions yet. Log your next buy or pass above, or use &quot;Log decision&quot; on any coin.</p>;

  return (
    <Card>
      <SectionTitle title="Decisions" subtitle="Newest first. Results run until today, or until you mark a buy as sold." />
      {error && <p className="mb-2 text-sm text-down">{error}</p>}
      <div className="overflow-x-auto">
        <table className="tabular w-full min-w-[980px] text-sm">
          <thead className="text-left text-xs font-bold text-fg">
            <tr className="border-b border-line">
              <th className="py-1.5">Date</th>
              <th className="py-1.5">Coin</th>
              <th className="py-1.5">Decision</th>
              <th className="py-1.5">The app said</th>
              <th className="py-1.5">Stage then</th>
              <th className="py-1.5 text-right">Price then → now</th>
              <th className="py-1.5 text-right">Return</th>
              <th className="py-1.5 text-right">BTC</th>
              <th className="py-1.5 text-right">vs BTC</th>
              <th className="py-1.5" />
            </tr>
          </thead>
          <tbody>
            {data.decisions.map((d) => (
              <Row
                key={d.id}
                d={d}
                minDays={data.minDays}
                selling={selling === d.id}
                sellForm={
                  <span className="flex flex-wrap items-center gap-2">
                    <input type="date" value={sellDate} onChange={(e) => setSellDate(e.target.value)} className={inputCls} />
                    <input type="number" min="0" step="any" placeholder="price: auto" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} className={`${inputCls} w-28`} />
                    <Button
                      size="sm"
                      onClick={() =>
                        act(() => api("/api/journal", { method: "PATCH", body: { id: d.id, closedOn: sellDate || undefined, price: sellPrice ? Number(sellPrice) : null } }))
                      }
                    >
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelling(null)}>
                      Cancel
                    </Button>
                  </span>
                }
                onSell={() => {
                  setSelling(d.id);
                  setSellDate("");
                  setSellPrice("");
                }}
                onReopen={() => act(() => api("/api/journal", { method: "PATCH", body: { id: d.id, reopen: true } }))}
                onDelete={() => window.confirm(`Delete this ${d.action} of ${d.symbol}?`) && act(() => api(`/api/journal?id=${d.id}`, { method: "DELETE" }))}
              />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Row({
  d,
  minDays,
  selling,
  sellForm,
  onSell,
  onReopen,
  onDelete,
}: {
  d: DecisionResult;
  minDays: number;
  selling: boolean;
  sellForm: React.ReactNode;
  onSell: () => void;
  onReopen: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <tr className={`border-b border-line align-top ${d.counted ? "" : "text-muted"}`}>
        <td className="py-2 text-muted">
          {fmtDate(d.decidedOn)} {d.decidedOn.slice(0, 4)}
          <div className="text-xs text-subtle">{d.closedOn ? `sold ${fmtDate(d.closedOn)} · ${d.days}d` : `${d.days} days`}</div>
        </td>
        <td className="py-2">
          <Link href={`/coin/${d.coinId}`} className="flex items-center gap-2 hover:underline">
            <CoinIcon src={d.image} alt={d.symbol} />
            <span className="font-semibold text-fg">{d.symbol}</span>
          </Link>
          {d.note && <div className="mt-1 max-w-56 text-xs text-subtle">{d.note}</div>}
        </td>
        <td className="py-2">
          <Badge tone={d.action === "buy" ? "good" : "neutral"}>{d.action === "buy" ? (d.closedOn ? "Bought · sold" : "Bought") : "Passed"}</Badge>
        </td>
        <td className="py-2">
          {d.verdict ? <Badge tone={VERDICT_TONE[d.verdict]}>{d.verdictLabel}</Badge> : <span className="text-subtle">—</span>}
          <div className="text-xs text-subtle">
            {d.score !== null ? `score ${d.score}` : ""}
            {d.loggedLate ? " · logged later" : ""}
          </div>
        </td>
        <td className="py-2">{d.stage ? <StageBadge stage={d.stage} /> : <span className="text-xs text-subtle">none</span>}</td>
        <td className="py-2 text-right text-fg-2">
          {fmtPrice(d.price)} → {fmtPrice(d.endPrice)}
        </td>
        <td className="py-2 text-right">
          <Pct value={d.return} />
        </td>
        <td className="py-2 text-right">
          <Pct value={d.btcReturn} className="opacity-70" />
        </td>
        <td className="py-2 text-right">
          <Pct value={d.vsBtc} />
          {!d.counted && <div className="text-xs text-subtle">counts at {minDays}d</div>}
        </td>
        <td className="py-2 text-right whitespace-nowrap">
          {d.action === "buy" &&
            (d.closedOn ? (
              <button type="button" onClick={onReopen} className="text-xs text-muted hover:text-fg">
                Reopen
              </button>
            ) : (
              <button type="button" onClick={onSell} className="text-xs font-semibold text-brand-strong hover:underline">
                Mark sold
              </button>
            ))}
          <button type="button" onClick={onDelete} className="ml-3 text-xs text-muted hover:text-down">
            Delete
          </button>
        </td>
      </tr>
      {selling && (
        <tr className="border-b border-line">
          <td colSpan={10} className="py-2">
            <span className="mr-2 text-xs text-muted">Sold on (empty = today, live price):</span>
            {sellForm}
          </td>
        </tr>
      )}
    </>
  );
}
