// AlphaGrowth (alphagrowth.io): free, keyless data API. Used for what the other
// free sources don't have: token unlock schedules, funding rounds and investors,
// and social community growth. Their terms ask for a citation: "Data: AlphaGrowth".
// Everything is cached for hours, and every caller treats a failure as "unknown".

import { getJson } from "@/lib/server/http";
import { cachedPersistent, MINUTE } from "@/lib/server/cache";
import { countApiCall } from "@/lib/server/db";
import type { CoinExtras, UnlockInfo } from "@/lib/types";

const BASE = "https://alphagrowth.io/api/v1";
const HOUR = 60 * MINUTE;

async function ag<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  try {
    await countApiCall("alphagrowth");
  } catch {
    // Usage counting is best-effort.
  }
  return getJson<T>(`${BASE}${path}${qs.size ? `?${qs}` : ""}`, { timeoutMs: 30_000 });
}

// ---- Token unlocks ----

export interface AgAllocation {
  category: string;
  recipient: string | null;
  tokens?: number;
  unlock_type: "cliff" | "linear_rate_change";
}

export interface AgUnlock {
  gecko_id: string | null;
  token: string;
  unlock_at: string;
  tokens: number | null;
  value_usd: number | null;
  pct_of_circulating: number | null;
  implausible: boolean;
  allocations: AgAllocation[];
}

interface AgUnlockPage {
  total_pages: number;
  unlocks: AgUnlock[];
}

/** Days ahead the unlock calendar covers. */
export const UNLOCK_DAYS = 90;
const INSIDERS = new Set(["insiders", "privateSale"]);
const CATEGORY_LABEL: Record<string, string> = {
  insiders: "team & advisors",
  privateSale: "investors",
  publicSale: "public sale",
  airdrop: "airdrop",
  farming: "farming",
  staking: "staking",
  ecosystem: "ecosystem",
  liquidity: "liquidity",
  noncirculating: "treasury",
};

/** Every unlock in the next 90 days, grouped by CoinGecko id. One download (12 pages) serves every coin for 12 hours. */
const unlockCalendar = () =>
  cachedPersistent("ag:unlocks:v1", 12 * HOUR, async () => {
    const first = await ag<AgUnlockPage>("/token-unlocks", { days: UNLOCK_DAYS, sort_by: "date", page: 1 });
    const rest: AgUnlock[] = [];
    for (let page = 2; page <= first.total_pages; page += 4) {
      const batch = await Promise.all(
        [page, page + 1, page + 2, page + 3]
          .filter((p) => p <= first.total_pages)
          .map((p) => ag<AgUnlockPage>("/token-unlocks", { days: UNLOCK_DAYS, sort_by: "date", page: p }).then((r) => r.unlocks)),
      );
      rest.push(...batch.flat());
    }
    const byCoin: Record<string, AgUnlock[]> = {};
    for (const u of [...first.unlocks, ...rest]) if (u.gecko_id) (byCoin[u.gecko_id] ??= []).push(u);
    return { asOf: new Date().toISOString(), byCoin };
  });

/**
 * A coin's unlocks over the next 90 days: cliff unlocks as a share of
 * circulating supply, who receives them, and the next few dates. Null when
 * the calendar can't be loaded or lists nothing for the coin.
 */
export async function unlocksFor(geckoId: string, circulating: number | null): Promise<UnlockInfo | null> {
  const cal = await unlockCalendar().catch(() => null);
  const list = cal?.byCoin[geckoId];
  return cal && list?.length ? summarizeUnlocks(list, circulating, cal.asOf) : null;
}

/** One row per day: schedules often split a day's unlock into several entries. */
function sameDay(list: AgUnlock[], shareOf: (u: AgUnlock) => number | null): UnlockInfo["events"] {
  const days = new Map<string, UnlockInfo["events"][number]>();
  for (const u of list) {
    const date = u.unlock_at.slice(0, 10);
    const tokens = u.allocations.filter((a) => a.unlock_type === "cliff").reduce((s, a) => s + (a.tokens ?? 0), 0);
    const share = shareOf(u);
    const value = u.implausible ? null : u.value_usd;
    const who = u.allocations.filter((a) => a.unlock_type === "cliff").map((a) => CATEGORY_LABEL[a.category] ?? a.recipient ?? a.category);
    const d = days.get(date);
    if (!d) days.set(date, { date, share, valueUsd: value, tokens, who: [...new Set(who)] });
    else {
      d.tokens += tokens;
      d.share = d.share !== null && share !== null ? d.share + share : (d.share ?? share);
      d.valueUsd = d.valueUsd !== null && value !== null ? d.valueUsd + value : (d.valueUsd ?? value);
      d.who = [...new Set([...d.who, ...who])];
    }
  }
  return [...days.values()];
}

/** The unlock numbers from a coin's calendar entries. Pure, for tests. */
export function summarizeUnlocks(list: AgUnlock[], circulating: number | null, asOf: string, now = Date.now()): UnlockInfo {
  const within = (days: number) => (u: AgUnlock) => Date.parse(u.unlock_at) - now <= days * 86_400_000;
  const cliffTokens = (u: AgUnlock) => u.allocations.filter((a) => a.unlock_type === "cliff").reduce((s, a) => s + (a.tokens ?? 0), 0);
  // The calendar's own share when it has one; else tokens ÷ circulating supply. Implausible schedules (>1,000% of supply) are skipped.
  const share = (u: AgUnlock) => {
    if (u.implausible) return null;
    if (u.pct_of_circulating !== null) return u.pct_of_circulating / 100;
    const t = cliffTokens(u);
    return circulating && t ? t / circulating : null;
  };
  const sum = (xs: AgUnlock[]) => xs.reduce((s, u) => s + (share(u) ?? 0), 0);
  const in90 = list.filter(within(UNLOCK_DAYS));
  const tokens90 = in90.reduce((s, u) => s + cliffTokens(u), 0);
  const insider90 = in90.reduce((s, u) => s + u.allocations.filter((a) => a.unlock_type === "cliff" && INSIDERS.has(a.category)).reduce((t, a) => t + (a.tokens ?? 0), 0), 0);
  const values = in90.flatMap((u) => (u.value_usd !== null && !u.implausible ? [u.value_usd] : []));
  return {
    next30: sum(list.filter(within(30))),
    next90: sum(in90),
    value90Usd: values.length ? values.reduce((a, b) => a + b, 0) : null,
    insiderShare: tokens90 > 0 ? insider90 / tokens90 : null,
    events: sameDay(in90.filter((u) => cliffTokens(u) > 0), share).slice(0, 8),
    linear: in90.some((u) => u.allocations.some((a) => a.unlock_type === "linear_rate_change")),
    asOf,
  };
}

// ---- Project: funding and community ----

export interface AgProjectHit {
  slug: string;
  name: string;
  symbol: string | null;
  market_cap_usd: number | null;
  page: string;
}

/**
 * AlphaGrowth's project for a coin. Its listings have near-duplicates (same
 * name and market cap, different slugs), so the entry whose slug is the coin's
 * CoinGecko id or name wins; otherwise the same ticker with the market cap
 * closest to ours (within 3×), so a ticker clash or an old version isn't picked.
 */
export const agProject = (coin: { id: string; name: string; symbol: string; marketCap: number | null }) =>
  cachedPersistent(`ag:project:v2:${coin.id}`, 7 * 24 * HOUR, async () => {
    const res = await ag<{ projects: AgProjectHit[] }>("/projects/find", { query: coin.name });
    const pick = pickProject(res.projects, coin);
    return pick ? { slug: pick.slug, name: pick.name, page: pick.page } : null;
  });

/** The listing that is this coin (see agProject). Pure, for tests. */
export function pickProject(hits: AgProjectHit[], coin: { id: string; name: string; symbol: string; marketCap: number | null }): AgProjectHit | null {
  const sym = coin.symbol.toLowerCase();
  const slugs = new Set([coin.id, coin.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")]);
  const canonical = hits.find((p) => slugs.has(p.slug) && (!p.symbol || p.symbol.toLowerCase() === sym));
  if (canonical) return canonical;
  const sameTicker = hits.filter((p) => p.symbol?.toLowerCase() === sym && p.market_cap_usd);
  const distance = (p: AgProjectHit) => Math.abs(Math.log((p.market_cap_usd as number) / (coin.marketCap as number)));
  const pick = coin.marketCap
    ? sameTicker.filter((p) => distance(p) < Math.log(3)).sort((a, b) => distance(a) - distance(b))[0]
    : sameTicker.find((p) => p.name.toLowerCase() === coin.name.toLowerCase());
  return pick ?? null;
}

interface AgFunding {
  total_raised_usd: number | null;
  investors: { name: string }[];
  rounds: { amount_usd: number | null; announced_on: string | null; announcement_url: string | null; type: string | null; valuation_usd: number | null }[];
}

interface AgNetwork {
  current: number | null;
  change_7d_pct: number | null;
  change_30d_pct: number | null;
}

const NETWORKS: [string, string][] = [
  ["twitter", "X"],
  ["discord", "Discord"],
  ["telegram", "Telegram"],
  ["reddit", "Reddit"],
];

/** Funding rounds, investors and community growth for the coin page. Nothing here is scored. */
export const coinExtras = (coin: { id: string; name: string; symbol: string; marketCap: number | null }) =>
  cachedPersistent(`ag:extras:v2:${coin.id}`, 24 * HOUR, async (): Promise<CoinExtras> => {
    const project = await agProject(coin).catch(() => null);
    if (!project) return { project: null, funding: null, community: [] };
    const [funding, community] = await Promise.all([
      ag<AgFunding>("/projects/funding", { slug: project.slug }).catch(() => null),
      ag<{ networks: Record<string, AgNetwork> }>("/projects/community", { slug: project.slug, days: 30 }).catch(() => null),
    ]);
    const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 100);
    return {
      project,
      funding:
        funding && (funding.rounds.length || funding.investors.length)
          ? {
              totalRaised: funding.total_raised_usd,
              rounds: funding.rounds.map((r) => ({ date: r.announced_on, type: r.type ?? "Unknown", amount: r.amount_usd, valuation: r.valuation_usd, url: r.announcement_url })),
              investors: funding.investors.map((i) => i.name),
            }
          : null,
      community: NETWORKS.flatMap(([key, label]) => {
        const n = community?.networks[key];
        return n?.current ? [{ network: label, followers: n.current, change7d: pct(n.change_7d_pct), change30d: pct(n.change_30d_pct) }] : [];
      }),
    };
  });
