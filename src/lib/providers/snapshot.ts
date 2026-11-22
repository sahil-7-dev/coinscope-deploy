// Snapshot: off-chain governance activity (proposals and votes) for a
// project's spaces, found through DefiLlama's project metadata. Free and keyless.

import { cachedPersistent, MINUTE } from "@/lib/server/cache";
import type { Governance } from "@/lib/types";

const DAY = 86_400;

interface Proposal {
  created: number;
  votes: number;
  space: { id: string };
}

/** Space names projects commonly use: "aavedao.eth", "arbitrumfoundation.eth", "uniswapgovernance.eth"… */
export function guessSpaces(name: string, symbol: string): string[] {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s = symbol.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Bare "{symbol}.eth" is left out: short names are often unrelated spaces.
  return [...new Set([`${n}dao.eth`, `${s}dao.eth`, `${n}.eth`, `${n}governance.eth`, `${n}foundation.eth`])].filter((x) => x.length > 6);
}

/**
 * Proposals over the last 90 days (and the 90 before) in the busiest of the
 * given spaces. Null when none of them had a proposal in 6 months: spaces get
 * renamed, so silence means "unknown", not "no governance".
 */
export function governance(spaces: string[]): Promise<Governance | null> {
  if (!spaces.length) return Promise.resolve(null);
  return cachedPersistent(`snapshot2:${[...spaces].sort().join(",")}`, 24 * 60 * MINUTE, async () => {
    const since = Math.floor(Date.now() / 1000) - 180 * DAY;
    const query = `{ proposals(first: 1000, where: { space_in: ${JSON.stringify(spaces)}, created_gte: ${since} }, orderBy: "created", orderDirection: desc) { created votes space { id } } }`;
    const res = await fetch("https://hub.snapshot.org/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    }).catch(() => null);
    if (!res?.ok) return null;
    const proposals = ((await res.json().catch(() => null)) as { data?: { proposals?: Proposal[] } } | null)?.data?.proposals;
    if (!proposals?.length) return null;

    const bySpace = new Map<string, Proposal[]>();
    for (const p of proposals) bySpace.set(p.space.id, [...(bySpace.get(p.space.id) ?? []), p]);
    const [space, list] = [...bySpace].sort((a, b) => b[1].length - a[1].length)[0] ?? [spaces[0], []];
    const cutoff = Math.floor(Date.now() / 1000) - 90 * DAY;
    const recent = list.filter((p) => p.created >= cutoff);
    return {
      space,
      proposals90d: recent.length,
      proposalsPrev90d: list.length - recent.length,
      avgVotes: recent.length ? Math.round(recent.reduce((s, p) => s + p.votes, 0) / recent.length) : null,
      lastProposal: list[0] ? new Date(list[0].created * 1000).toISOString().slice(0, 10) : null,
    };
  });
}
