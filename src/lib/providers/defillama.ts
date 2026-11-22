// DefiLlama: TVL, fees and revenue for DeFi protocols and L1/L2 chains, matched
// by CoinGecko id. Free and keyless. Any failure here just means "no fundamentals".

import type { Fundamentals, Peer } from "@/lib/types";
import { cached, MINUTE } from "@/lib/server/cache";
import { getJson, HttpError } from "@/lib/server/http";

interface LlamaProtocol {
  name: string;
  slug: string;
  gecko_id: string | null;
  symbol?: string | null;
  parentProtocol?: string; // e.g. "parent#aave"
  tvl: number | null;
  change_7d: number | null;
  category?: string | null;
  audits?: string | null;
  listedAt?: number | null;
  chains?: string[];
  mcap?: number | null;
}

/** A protocol with all its versions (Aave V2 + V3 + V4…) summed. */
interface ProtocolGroup {
  name: string;
  symbol: string | null;
  /** Slug for the fees endpoint; parent slugs return the aggregate. */
  slug: string;
  tvl: number;
  tvlWeekAgo: number;
  /** Category of its biggest version. */
  category: string | null;
  audits: number | null;
  listedAt: number | null;
  /** Names of every version, for matching hacks. */
  names: Set<string>;
}

const titleCase = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

interface LlamaChain {
  name: string;
  gecko_id: string | null;
  tokenSymbol?: string | null;
  tvl: number;
}

/**
 * Protocol groups keyed by CoinGecko id. Versions share a `parentProtocol`, and
 * the token's gecko_id often sits on an old version only, so TVL is summed per
 * parent. The parent slug doubles as a gecko id guess (parent#uniswap → uniswap).
 */
/** Every protocol DefiLlama tracks (raw list, ~10 MB), shared by the views below. */
const protocolList = () => cached("llama:protocols", 30 * MINUTE, () => getJson<LlamaProtocol[]>("https://api.llama.fi/protocols", { timeoutMs: 30_000 }));

/** Organizations rather than products (e.g. "Ethereum Foundation" carries ETH's CoinGecko id): never a coin's fundamentals. */
const NOT_PRODUCTS = new Set(["Foundation", "Treasury Manager", "DAO Service Provider", "Developer Tools"]);

const protocolGroups = () =>
  cached("llama:protocol-groups:v3", 30 * MINUTE, async () => {
    const list = (await protocolList()).filter((p) => !NOT_PRODUCTS.has(p.category ?? ""));
    const groups = new Map<string, ProtocolGroup & { geckoIds: Set<string>; topTvl: number }>();
    for (const p of list) {
      // Fee-only apps (no TVL) still count, as long as they have a token.
      const tvl = Math.max(0, p.tvl ?? 0);
      if (tvl <= 0 && !p.gecko_id) continue;
      const parentSlug = p.parentProtocol?.replace(/^parent#/, "");
      const key = parentSlug ? `parent:${parentSlug}` : p.slug;
      let g = groups.get(key);
      if (!g) {
        g = {
          name: parentSlug ? titleCase(parentSlug) : p.name,
          slug: parentSlug ?? p.slug,
          symbol: null,
          tvl: 0,
          tvlWeekAgo: 0,
          category: null,
          audits: null,
          listedAt: null,
          names: new Set(),
          geckoIds: new Set(),
          topTvl: -1,
        };
        groups.set(key, g);
      }
      g.names.add(p.name.toLowerCase());
      if (tvl > g.topTvl && p.category) {
        g.category = p.category;
        g.topTvl = tvl;
      }
      const audits = Number(p.audits);
      if (p.audits && Number.isFinite(audits)) g.audits = Math.max(g.audits ?? 0, audits);
      if (p.listedAt) g.listedAt = Math.min(g.listedAt ?? Infinity, p.listedAt);
      if (!g.symbol && p.symbol && p.symbol !== "-") g.symbol = p.symbol.toUpperCase();
      if (parentSlug) g.geckoIds.add(parentSlug);
      if (p.gecko_id) g.geckoIds.add(p.gecko_id);
      g.tvl += tvl;
      g.tvlWeekAgo += p.change_7d !== null && p.change_7d > -100 ? tvl / (1 + p.change_7d / 100) : tvl;
    }

    const byGecko = new Map<string, ProtocolGroup>();
    for (const g of groups.values()) {
      for (const id of g.geckoIds) {
        const prev = byGecko.get(id);
        if (!prev || prev.tvl < g.tvl) byGecko.set(id, g);
      }
    }
    return byGecko;
  });

const chainSlug = (name: string) => name.toLowerCase().replace(/\s+/g, "-");

interface OverviewEntry {
  name: string;
  slug: string;
  category: string | null;
  protocolType?: "protocol" | "chain";
  parentProtocol?: string;
  total30d: number | null;
  total60dto30d?: number | null;
}

export interface OverviewItem {
  slug: string;
  name: string;
  category: string;
  fees30d: number;
  feesPrev30d: number;
  chain: boolean;
}

/** Fees over 30 days for every protocol and chain (versions summed per parent), with category ranks. */
export const feeOverview = () =>
  cached("llama:fee-overview:v2", 6 * 60 * MINUTE, async () => {
    const res = await getJson<{ protocols: OverviewEntry[] }>(
      "https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true",
      { timeoutMs: 60_000 },
    );
    const bySlug = new Map<string, OverviewItem>();
    for (const e of res.protocols) {
      if (!e.category || !(e.total30d && e.total30d > 0)) continue;
      const key = e.parentProtocol?.replace(/^parent#/, "") ?? e.slug;
      const prev = bySlug.get(key);
      if (prev) {
        prev.fees30d += e.total30d;
        prev.feesPrev30d += e.total60dto30d ?? 0;
      } else {
        const name = e.parentProtocol ? titleCase(key) : e.name;
        bySlug.set(key, { slug: key, name, category: e.category, fees30d: e.total30d, feesPrev30d: e.total60dto30d ?? 0, chain: e.protocolType === "chain" });
      }
    }
    const byCategory = new Map<string, OverviewItem[]>();
    for (const v of bySlug.values()) {
      const list = byCategory.get(v.category);
      if (list) list.push(v);
      else byCategory.set(v.category, [v]);
    }
    const rank = new Map<string, { category: string; share: number; rank: number; peers: number }>();
    for (const [category, list] of byCategory) {
      const total = list.reduce((s, x) => s + x.fees30d, 0);
      list.sort((a, b) => b.fees30d - a.fees30d).forEach((x, i) => rank.set(x.slug, { category, share: total ? x.fees30d / total : 0, rank: i + 1, peers: list.length }));
    }
    return { bySlug, byCategory, rank };
  });

/** Token market cap per protocol slug (parents included), for peers' valuations. */
const marketCaps = () =>
  cached("llama:mcaps:v2", 30 * MINUTE, async () => {
    const out = new Map<string, number>();
    // Parent protocols carry the token's market cap in the lite list ("parent#morpho" → "morpho").
    const lite = await liteList().catch(() => null);
    for (const p of lite?.parentProtocols ?? []) {
      const key = p.id?.replace(/^parent#/, "");
      if (key && p.mcap && p.mcap > 0) out.set(key, p.mcap);
    }
    for (const p of await protocolList()) {
      if (!p.mcap || p.mcap <= 0) continue;
      for (const key of [p.slug, p.parentProtocol?.replace(/^parent#/, "")]) if (key && (out.get(key) ?? 0) < p.mcap) out.set(key, p.mcap);
    }
    return out;
  });

/** The biggest fee earners in a slug's category, plus the slug itself if it's not among them. */
async function peersOf(slug: string, selfMarketCap: number | null): Promise<Peer[]> {
  const [overview, mcaps] = await Promise.all([feeOverview().catch(() => null), marketCaps().catch(() => new Map<string, number>())]);
  const rank = overview?.rank.get(slug);
  const list = rank ? (overview?.byCategory.get(rank.category) ?? []) : [];
  const total = list.reduce((s, x) => s + x.fees30d, 0);
  const picked = list.slice(0, 6);
  const self = list.find((x) => x.slug === slug);
  if (self && !picked.includes(self)) picked.push(self);
  return picked.map((x) => {
    const mcap = x.slug === slug ? selfMarketCap : (mcaps.get(x.slug) ?? null);
    return {
      name: x.name,
      fees30d: x.fees30d,
      feesGrowth30d: x.feesPrev30d > 0 ? x.fees30d / x.feesPrev30d - 1 : null,
      share: total ? x.fees30d / total : 0,
      marketCap: mcap,
      priceToFees: mcap ? mcap / (x.fees30d * ANNUALIZE_30D) : null,
      isSelf: x.slug === slug,
    };
  });
}

type HackSummary = { count: number; lostUsd: number; last: string | null };

/** Hacks per protocol name (lowercase): how many, how much was lost, and the latest. */
const hacksByName = () =>
  cached("llama:hacks", 24 * 60 * MINUTE, async () => {
    const list = await getJson<{ date: number; name: string; amount: number | null }[]>("https://api.llama.fi/hacks", { timeoutMs: 30_000 });
    const out = new Map<string, HackSummary>();
    for (const h of list) {
      const key = h.name.toLowerCase();
      const prev = out.get(key) ?? { count: 0, lostUsd: 0, last: null };
      const date = new Date(h.date * 1000).toISOString().slice(0, 10);
      out.set(key, { count: prev.count + 1, lostUsd: prev.lostUsd + (h.amount ?? 0), last: !prev.last || date > prev.last ? date : prev.last });
    }
    return out;
  });

function hacksFor(names: Iterable<string>, hacks: Map<string, HackSummary>): HackSummary {
  const found: HackSummary = { count: 0, lostUsd: 0, last: null };
  for (const n of names) {
    const h = hacks.get(n);
    if (!h) continue;
    found.count += h.count;
    found.lostUsd += h.lostUsd;
    if ((h.last ?? "") > (found.last ?? "")) found.last = h.last;
  }
  return found;
}

export interface FeeSource {
  kind: "protocol" | "chain";
  name: string;
  /** Slug for the fees endpoint. */
  slug: string;
  tvl: number;
  /** DefiLlama category ("Chain" for chains), for counting new launches around it. */
  category: string | null;
}

/**
 * Fee sources keyed by token symbol ("AAVE", "SOL"), for backtests where coins
 * are known by ticker only. Only tokens with a CoinGecko id count, and the
 * biggest TVL wins a symbol clash.
 */
export const feeSourcesBySymbol = () =>
  cached("llama:fee-sources:v4", 30 * MINUTE, async () => {
    const [protocols, chains] = await Promise.all([protocolGroups(), chainsByGeckoId()]);
    const out = new Map<string, FeeSource>();
    const add = (symbol: string | null | undefined, src: FeeSource) => {
      const sym = symbol?.toUpperCase();
      if (!sym || sym === "-") return;
      const prev = out.get(sym);
      if (!prev || prev.tvl < src.tvl) out.set(sym, src);
    };
    for (const g of new Set(protocols.values())) add(g.symbol, { kind: "protocol", name: g.name, slug: g.slug, tvl: g.tvl, category: g.category });
    for (const c of chains.values()) add(c.tokenSymbol, { kind: "chain", name: c.name, slug: chainSlug(c.name), tvl: c.tvl, category: "Chain" });
    return out;
  });

const chainsByGeckoId = () =>
  cached("llama:chains", 30 * MINUTE, async () => {
    const list = await getJson<LlamaChain[]>("https://api.llama.fi/v2/chains");
    return new Map(list.filter((c) => c.gecko_id).map((c) => [c.gecko_id as string, c]));
  });

interface FlowTotals {
  last30: number;
  prev30: number;
  last90: number;
  prev90: number;
}

export type FlowType = "dailyFees" | "dailyRevenue" | "dailyHoldersRevenue";

/** One value per day, oldest first. */
export interface FlowSeries {
  dates: string[];
  values: number[];
}

/** Daily fees or revenue history for a protocol/chain slug, or null when DefiLlama has no adapter for it. */
export const flowSeries = (slug: string, dataType: FlowType) =>
  cached(`llama:${dataType}:${slug}`, 30 * MINUTE, async (): Promise<FlowSeries | null> => {
    try {
      const res = await getJson<{ totalDataChart?: [number, number][] }>(
        `https://api.llama.fi/summary/fees/${encodeURIComponent(slug)}?dataType=${dataType}&excludeTotalDataChartBreakdown=true`,
      );
      const chart = res.totalDataChart ?? [];
      return { dates: chart.map(([ts]) => new Date(ts * 1000).toISOString().slice(0, 10)), values: chart.map(([, v]) => v ?? 0) };
    } catch (err) {
      if (err instanceof HttpError) return null; // no fee/revenue adapter
      throw err;
    }
  });

/** Daily fees or revenue summed into 30/90-day windows. */
async function dailyFlows(slug: string, dataType: FlowType): Promise<FlowTotals | null> {
  const values = (await flowSeries(slug, dataType))?.values ?? [];
  if (values.length < 30) return null;
  const sum = (from: number, to: number) => values.slice(Math.max(0, values.length - to), values.length - from).reduce((a, b) => a + b, 0);
  return { last30: sum(0, 30), prev30: sum(30, 60), last90: sum(0, 90), prev90: values.length >= 180 ? sum(90, 180) : 0 };
}

const chainTvlHistory = (chain: string) =>
  cached(`llama:chainhist:${chain}`, 30 * MINUTE, () =>
    getJson<{ date: number; tvl: number }[]>(`https://api.llama.fi/v2/historicalChainTvl/${encodeURIComponent(chain)}`),
  );

const growth = (now: number | null | undefined, before: number | null | undefined) =>
  now !== null && now !== undefined && before ? now / before - 1 : null;
const ANNUALIZE_30D = 365 / 30;

type FundamentalsBase = Pick<Fundamentals, "kind" | "name" | "tvl" | "tvlChange7d" | "category" | "audits" | "hacks" | "listedAt" | "stablecoins" | "launches">;

/** Stablecoins and new launches on a chain (by DefiLlama chain name). */
async function chainActivity(name: string): Promise<Pick<Fundamentals, "stablecoins" | "launches">> {
  const [flows, launched] = await Promise.all([stablecoinFlows().catch(() => null), launches().catch(() => null)]);
  const f = flows?.byChain.get(name.toLowerCase());
  const l = launched?.byChain.get(name.toLowerCase());
  return {
    stablecoins: f ? { current: f.current, change7d: f.change7d, change30d: f.change30d } : null,
    launches: l ? { last90: l.last90, prev90: l.prev90 } : null,
  };
}

async function withFlows(base: FundamentalsBase, slug: string, marketCap: number | null): Promise<Fundamentals> {
  const [fees, revenue, holders, overview, peers] = await Promise.all([
    dailyFlows(slug, "dailyFees"),
    dailyFlows(slug, "dailyRevenue"),
    dailyFlows(slug, "dailyHoldersRevenue"),
    feeOverview().catch(() => null),
    peersOf(slug, marketCap).catch(() => [] as Peer[]),
  ]);
  const rank = overview?.rank.get(slug);
  const share = (part: number | null | undefined) => (part != null && fees?.last30 ? Math.min(1, part / fees.last30) : null);
  const feesAnnualized = fees ? fees.last30 * ANNUALIZE_30D : null;
  const revenueAnnualized = revenue ? revenue.last30 * ANNUALIZE_30D : null;
  return {
    source: "DefiLlama",
    slug,
    ...base,
    mcapToTvl: marketCap && base.tvl ? marketCap / base.tvl : null,
    fees30d: fees?.last30 ?? null,
    feesPrev30d: fees?.prev30 ?? null,
    fees90d: fees?.last90 ?? null,
    feesPrev90d: fees?.prev90 || null,
    revenue30d: revenue?.last30 ?? null,
    revenue90d: revenue?.last90 ?? null,
    revenuePrev90d: revenue?.prev90 || null,
    feesAnnualized,
    revenueAnnualized,
    priceToFees: marketCap && feesAnnualized ? marketCap / feesAnnualized : null,
    priceToSales: marketCap && revenueAnnualized ? marketCap / revenueAnnualized : null,
    feesGrowth30d: growth(fees?.last30, fees?.prev30),
    feesGrowth90d: growth(fees?.last90, fees?.prev90),
    revenueGrowth90d: growth(revenue?.last90, revenue?.prev90),
    holdersRevenue30d: holders?.last30 ?? null,
    holderShare: share(holders?.last30),
    revenueShare: share(revenue?.last30),
    category: base.category ?? rank?.category ?? null,
    categoryShare: rank?.share ?? null,
    categoryRank: rank?.rank ?? null,
    categoryPeers: rank?.peers ?? null,
    peers,
  };
}

const isoDay = (unix: number | null) => (unix ? new Date(unix * 1000).toISOString().slice(0, 10) : null);

/** Fundamentals for a CoinGecko id. `name` helps find fee-only chains (no TVL) by name. */
export async function getFundamentals(geckoId: string, marketCap: number | null, name?: string): Promise<Fundamentals | null> {
  try {
    const [protocols, chains, hacks] = await Promise.all([protocolGroups(), chainsByGeckoId(), hacksByName().catch(() => new Map<string, HackSummary>())]);

    const protocol = protocols.get(geckoId);
    if (protocol) {
      return withFlows(
        {
          kind: "protocol",
          name: protocol.name,
          tvl: protocol.tvl || null,
          tvlChange7d: protocol.tvlWeekAgo > 0 ? protocol.tvl / protocol.tvlWeekAgo - 1 : null,
          category: protocol.category,
          audits: protocol.audits,
          hacks: hacksFor([...protocol.names, protocol.name.toLowerCase()], hacks),
          listedAt: isoDay(protocol.listedAt),
          stablecoins: null,
          launches: null,
        },
        protocol.slug,
        marketCap,
      );
    }

    const chain = chains.get(geckoId);
    if (chain && chain.tvl > 0) {
      const hist = await chainTvlHistory(chain.name).catch(() => []);
      const at = (back: number) => hist[hist.length - 1 - back]?.tvl;
      return withFlows(
        {
          kind: "chain",
          name: chain.name,
          tvl: chain.tvl,
          tvlChange7d: hist.length > 8 ? growth(at(0), at(7)) : null,
          category: "Chain",
          audits: null,
          hacks: null,
          listedAt: null,
          ...(await chainActivity(chain.name)),
        },
        chainSlug(chain.name),
        marketCap,
      );
    }

    // Fee-only: chains like Zcash or Monero earn fees but have no TVL listing.
    const overview = await feeOverview().catch(() => null);
    const wanted = name?.toLowerCase();
    const item = overview?.bySlug.get(geckoId) ?? [...(overview?.bySlug.values() ?? [])].find((x) => x.chain && x.name.toLowerCase() === wanted);
    if (item) {
      return withFlows(
        {
          kind: item.chain ? "chain" : "protocol",
          name: item.name,
          tvl: null,
          tvlChange7d: null,
          category: item.category,
          audits: null,
          hacks: null,
          listedAt: null,
          ...(item.chain ? await chainActivity(item.name) : { stablecoins: null, launches: null }),
        },
        item.slug,
        marketCap,
      );
    }
    return null;
  } catch (err) {
    console.warn("[defillama]", err instanceof Error ? err.message : err);
    return null;
  }
}

// ---- Builders: where new projects are launching ----

export interface LaunchCount {
  name: string;
  /** Protocols DefiLlama started tracking in the last 90 days, and in the 90 days before. */
  last90: number;
  prev90: number;
}

export interface Launches {
  categories: LaunchCount[];
  chains: LaunchCount[];
  /** Chain name (lowercase) → its counts, for looking up a chain coin. */
  byChain: Map<string, LaunchCount>;
}

/** New protocols per DefiLlama category and per chain: builders tend to arrive before the crowd. */
export const launches = () =>
  cached("llama:launches", 6 * 60 * MINUTE, async (): Promise<Launches> => {
    const list = await protocolList();
    const now = Date.now() / 1000;
    const DAY = 86_400;
    const cats = new Map<string, LaunchCount>();
    const chains = new Map<string, LaunchCount>();
    const bump = (m: Map<string, LaunchCount>, name: string, recent: boolean) => {
      const c = m.get(name) ?? { name, last90: 0, prev90: 0 };
      if (recent) c.last90++;
      else c.prev90++;
      m.set(name, c);
    };
    for (const p of list) {
      if (!p.listedAt || p.listedAt < now - 180 * DAY) continue;
      const recent = p.listedAt >= now - 90 * DAY;
      if (p.category) bump(cats, p.category, recent);
      for (const ch of p.chains ?? []) bump(chains, ch, recent);
    }
    const sorted = (m: Map<string, LaunchCount>) => [...m.values()].sort((a, b) => b.last90 - a.last90);
    return { categories: sorted(cats), chains: sorted(chains), byChain: new Map([...chains].map(([k, v]) => [k.toLowerCase(), v])) };
  });

// ---- Capital: stablecoins flowing into each chain ----

export interface StablecoinFlow {
  chain: string;
  current: number;
  change7d: number | null;
  change30d: number | null;
}

interface PeggedAsset {
  pegType: string;
  chainCirculating: Record<string, { current?: Record<string, number>; circulatingPrevWeek?: Record<string, number>; circulatingPrevMonth?: Record<string, number> }>;
}

/** Stablecoins on each chain now vs a week and a month ago (all pegs, in their peg currency ≈ USD). One call. */
export const stablecoinFlows = () =>
  cached("llama:stablecoin-flows", 6 * 60 * MINUTE, async () => {
    const res = await getJson<{ peggedAssets: PeggedAsset[] }>("https://stablecoins.llama.fi/stablecoins?includePrices=false", { timeoutMs: 30_000 });
    const sum = (v?: Record<string, number>) => Object.values(v ?? {}).reduce((s, x) => s + (Number(x) || 0), 0);
    const totals = new Map<string, { now: number; week: number; month: number }>();
    for (const a of res.peggedAssets) {
      for (const [chain, c] of Object.entries(a.chainCirculating ?? {})) {
        const t = totals.get(chain) ?? { now: 0, week: 0, month: 0 };
        t.now += sum(c.current);
        t.week += sum(c.circulatingPrevWeek);
        t.month += sum(c.circulatingPrevMonth);
        totals.set(chain, t);
      }
    }
    const flows: StablecoinFlow[] = [...totals]
      .filter(([, t]) => t.now >= 10e6)
      .map(([chain, t]) => ({ chain, current: t.now, change7d: t.week > 0 ? t.now / t.week - 1 : null, change30d: t.month > 0 ? t.now / t.month - 1 : null }))
      .sort((a, b) => b.current - a.current);
    return { flows, byChain: new Map(flows.map((f) => [f.chain.toLowerCase(), f])) };
  });

// ---- Project links: GitHub orgs and governance spaces ----

interface LiteProject {
  id?: string;
  name: string;
  gecko_id?: string | null;
  geckoId?: string | null;
  github?: string[] | null;
  governanceID?: string[] | null;
  mcap?: number | null;
}

/** DefiLlama's project metadata, parents included (~7 MB), shared by the views below. */
const liteList = () =>
  cached("llama:lite", 6 * 60 * MINUTE, () =>
    getJson<{ parentProtocols: LiteProject[]; protocols: LiteProject[] }>("https://api.llama.fi/lite/protocols2?b=2", { timeoutMs: 60_000 }),
  );

/** GitHub orgs and Snapshot spaces per CoinGecko id, from DefiLlama's project metadata. */
export const projectLinks = () =>
  cached("llama:project-links", 6 * 60 * MINUTE, async () => {
    const res = await liteList();
    const out = new Map<string, { github: string[]; snapshot: string[] }>();
    for (const p of [...res.parentProtocols, ...res.protocols]) {
      const id = p.gecko_id ?? p.geckoId;
      if (!id) continue;
      const prev = out.get(id) ?? { github: [], snapshot: [] };
      for (const g of p.github ?? []) if (!prev.github.includes(g)) prev.github.push(g);
      for (const g of p.governanceID ?? []) {
        const space = g.startsWith("snapshot:") ? g.slice("snapshot:".length) : null;
        if (space && !prev.snapshot.includes(space)) prev.snapshot.push(space);
      }
      out.set(id, prev);
    }
    return out;
  });

/**
 * When each protocol was first listed (seconds, sorted), per category and per
 * chain (lowercase), so launches can be counted for any window, past or present.
 */
export const listingTimes = () =>
  cached("llama:listing-times:v2", 6 * 60 * MINUTE, async () => {
    const byCategory = new Map<string, number[]>();
    const byChain = new Map<string, number[]>();
    const all: number[] = [];
    const push = (m: Map<string, number[]>, key: string, t: number) => {
      const list = m.get(key);
      if (list) list.push(t);
      else m.set(key, [t]);
    };
    for (const p of await protocolList()) {
      if (!p.listedAt) continue;
      all.push(p.listedAt);
      if (p.category) push(byCategory, p.category, p.listedAt);
      for (const ch of p.chains ?? []) push(byChain, ch.toLowerCase(), p.listedAt);
    }
    for (const list of [all, ...byCategory.values(), ...byChain.values()]) list.sort((a, b) => a - b);
    return { all, byCategory, byChain };
  });
