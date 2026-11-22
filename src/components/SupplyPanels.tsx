"use client";

import { useEffect, useState } from "react";
import type { CoinExtras, CoinProfile, HolderConcentration, HolderKind, UnlockInfo } from "@/lib/types";
import { api, errMsg } from "@/lib/api";
import { fmtDate, fmtNum, fmtPct, fmtUsd } from "@/lib/format";
import { Pct, Spinner } from "./ui";

const share = (x: number | null | undefined) => fmtPct(x ?? null, { signed: false });
const KIND: Record<HolderKind, string> = { wallet: "Wallet", contract: "Contract", exchange: "Exchange", burn: "Burn" };

/** Scheduled unlocks and who holds the token: the supply side of a mid-term hold. */
export function SupplyPanel({ p }: { p: CoinProfile }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Unlocks u={p.unlocks} circulatingRatio={p.supply.circulatingRatio} />
      <Holders h={p.holders} />
    </div>
  );
}

function Unlocks({ u, circulatingRatio }: { u: UnlockInfo | null | undefined; circulatingRatio: number | null }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-fg">Unlocks in the next 90 days</h3>
      {u === undefined ? (
        <p className="mt-1 text-sm text-muted">Re-analyze the coin to load its unlock schedule.</p>
      ) : u === null ? (
        <p className="mt-1 text-sm text-muted">
          No scheduled unlocks listed for the next 90 days. That&apos;s either a fully unlocked token or one AlphaGrowth doesn&apos;t track
          {circulatingRatio !== null && circulatingRatio < 0.9 ? ` (only ${share(circulatingRatio)} of supply circulates, so check the project's docs)` : ""}.
        </p>
      ) : (
        <>
          <p className="mt-1 text-sm text-fg-2">
            <b className="text-fg">{share(u.next90)}</b> of circulating supply{u.value90Usd ? ` (about ${fmtUsd(u.value90Usd)})` : ""} unlocks in 90 days,{" "}
            <b className="text-fg">{share(u.next30)}</b> of it in the next 30.
            {u.insiderShare !== null && ` ${share(u.insiderShare)} goes to team, advisors and investors.`}
          </p>
          {u.events.length > 0 && (
            <table className="tabular mt-2 w-full text-sm">
              <thead className="text-left text-xs font-bold text-fg">
                <tr className="border-b border-line">
                  <th className="py-1.5">Date</th>
                  <th className="py-1.5 text-right">Of circulating</th>
                  <th className="py-1.5 text-right">Value</th>
                  <th className="py-1.5 pl-3">To</th>
                </tr>
              </thead>
              <tbody>
                {u.events.map((e) => (
                  <tr key={e.date + e.tokens} className="border-b border-line">
                    <td className="py-1.5 text-fg-2">
                      {fmtDate(e.date)} {e.date.slice(0, 4)}
                    </td>
                    <td className="py-1.5 text-right text-fg-2">{share(e.share)}</td>
                    <td className="py-1.5 text-right text-muted">{fmtUsd(e.valueUsd)}</td>
                    <td className="py-1.5 pl-3 text-muted">{e.who.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {u.linear && <p className="mt-1 text-xs text-subtle">Some allocations also vest gradually; those aren&apos;t counted above.</p>}
          <p className="mt-1 text-xs text-subtle">Data: AlphaGrowth, from published emission schedules. A team &quot;unlock&quot; may vest per person rather than hit the market at once.</p>
        </>
      )}
    </div>
  );
}

function Holders({ h }: { h: HolderConcentration | null | undefined }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-fg">Who holds it</h3>
      {h === undefined ? (
        <p className="mt-1 text-sm text-muted">Re-analyze the coin to load its holders.</p>
      ) : h === null ? (
        <p className="mt-1 text-sm text-muted">No reading: a native coin, or a token without an Ethereum or Optimism contract (other chains&apos; explorers block automated requests).</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-fg-2">
            On {h.chain}, the top 10 holders own <b className="text-fg">{share(h.top10)}</b> of the supply
            {h.top10Wallets !== null && (
              <>
                ; plain wallets among them own <b className="text-fg">{share(h.top10Wallets)}</b>
              </>
            )}
            .{h.holders ? ` ${fmtNum(h.holders)} holders in total.` : ""}
          </p>
          <table className="tabular mt-2 w-full text-sm">
            <thead className="text-left text-xs font-bold text-fg">
              <tr className="border-b border-line">
                <th className="py-1.5">Holder</th>
                <th className="py-1.5">Type</th>
                <th className="py-1.5 text-right">Share</th>
              </tr>
            </thead>
            <tbody>
              {h.top.map((r) => (
                <tr key={r.address} className="border-b border-line">
                  <td className="py-1.5">
                    <a href={`https://${h.chain === "Optimism" ? "optimistic.etherscan.io" : "etherscan.io"}/address/${r.address}`} target="_blank" rel="noreferrer" className="text-fg-2 hover:underline">
                      {r.label ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`}
                    </a>
                  </td>
                  <td className="py-1.5 text-muted">{r.kind ? KIND[r.kind] : "—"}</td>
                  <td className="py-1.5 text-right text-fg-2">{share(r.share)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-subtle">
            Data: {h.source}. Burned tokens are left out. Exchanges hold their users&apos; coins and contracts are often staking, bridges or vesting, so plain wallets are the
            ones to watch. Covers this chain&apos;s supply only.
          </p>
        </>
      )}
    </div>
  );
}

/** Funding rounds, investors and community growth (AlphaGrowth). Shown as context; nothing here is scored. */
export function BackersPanel({ p }: { p: CoinProfile }) {
  const [data, setData] = useState<CoinExtras | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const q = new URLSearchParams({ id: p.id, name: p.name, symbol: p.symbol, mcap: String(p.marketCap ?? "") });
    api<CoinExtras>(`/api/coin-extras?${q}`)
      .then((d) => !cancelled && setData(d))
      .catch((err) => !cancelled && setError(errMsg(err, "Couldn't load backers")));
    return () => {
      cancelled = true;
    };
  }, [p.id, p.name, p.symbol, p.marketCap]);

  if (error) return <p className="text-sm text-muted">{error}</p>;
  if (!data) return <Spinner label="Loading funding and community…" />;
  if (!data.project) return <p className="text-sm text-muted">AlphaGrowth doesn&apos;t list this project, so there&apos;s no funding or community data.</p>;
  const f = data.funding;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="text-sm font-bold text-fg">Funding</h3>
        {!f ? (
          <p className="mt-1 text-sm text-muted">No funding rounds on record (common for community-launched or older projects).</p>
        ) : (
          <>
            <p className="mt-1 text-sm text-fg-2">
              {f.totalRaised ? (
                <>
                  Raised <b className="text-fg">{fmtUsd(f.totalRaised)}</b> in {f.rounds.length} {f.rounds.length === 1 ? "round" : "rounds"}.
                </>
              ) : (
                `${f.rounds.length} ${f.rounds.length === 1 ? "round" : "rounds"} on record (amounts not disclosed).`
              )}
            </p>
            {f.investors.length > 0 && (
              <p className="mt-1 text-sm text-muted">
                Backers: {f.investors.slice(0, 12).join(", ")}
                {f.investors.length > 12 ? ` and ${f.investors.length - 12} more` : ""}.
              </p>
            )}
            {f.rounds.length > 0 && (
              <table className="tabular mt-2 w-full text-sm">
                <thead className="text-left text-xs font-bold text-fg">
                  <tr className="border-b border-line">
                    <th className="py-1.5">Date</th>
                    <th className="py-1.5">Round</th>
                    <th className="py-1.5 text-right">Amount</th>
                    <th className="py-1.5 text-right">Valuation</th>
                  </tr>
                </thead>
                <tbody>
                  {[...f.rounds].reverse().map((r, i) => (
                    <tr key={`${r.date}-${i}`} className="border-b border-line">
                      <td className="py-1.5 text-muted">{r.date ?? "—"}</td>
                      <td className="py-1.5 text-fg-2">
                        {r.url ? (
                          <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {r.type}
                          </a>
                        ) : (
                          r.type
                        )}
                      </td>
                      <td className="py-1.5 text-right text-fg-2">{fmtUsd(r.amount)}</td>
                      <td className="py-1.5 text-right text-muted">{fmtUsd(r.valuation)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold text-fg">Community growth</h3>
        {data.community.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No community numbers on record.</p>
        ) : (
          <table className="tabular mt-2 w-full text-sm">
            <thead className="text-left text-xs font-bold text-fg">
              <tr className="border-b border-line">
                <th className="py-1.5">Network</th>
                <th className="py-1.5 text-right">Followers</th>
                <th className="py-1.5 text-right">7 days</th>
                <th className="py-1.5 text-right">30 days</th>
              </tr>
            </thead>
            <tbody>
              {data.community.map((c) => (
                <tr key={c.network} className="border-b border-line">
                  <td className="py-1.5 text-fg-2">{c.network}</td>
                  <td className="py-1.5 text-right text-fg-2">{fmtNum(c.followers)}</td>
                  <td className="py-1.5 text-right">
                    <Pct value={c.change7d} />
                  </td>
                  <td className="py-1.5 text-right">
                    <Pct value={c.change30d} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-subtle">
          Attention, not fundamentals: follower counts can be bought. A community growing while the price is flat can be an early sign worth checking.
        </p>
      </div>
      <p className="text-xs text-subtle lg:col-span-2">
        Data: AlphaGrowth (
        <a href={data.project.page} target="_blank" rel="noreferrer" className="hover:underline">
          {data.project.name}
        </a>
        ). Context only: nothing in this section changes the score or verdict.
      </p>
    </div>
  );
}
