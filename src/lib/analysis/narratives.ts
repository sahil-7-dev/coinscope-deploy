// Narrative tracker: the biggest specific CoinGecko sectors, each turned into
// an equal-weighted index of its top coins (multi-year Binance history), then
// compared with BTC and placed in a phase (see narrative-rules.ts).

import * as cg from "@/lib/providers/coingecko";
import { spotUsdtPairs } from "@/lib/providers/binance";
import { feeSourcesBySymbol, flowSeries, launches, listingTimes, stablecoinFlows, type FlowSeries } from "@/lib/providers/defillama";
import { getNews } from "@/lib/providers/news";
import type { DailyBar } from "@/lib/providers/types";
import { cached, cachedUntil, MINUTE, peek } from "@/lib/server/cache";
import { getKv, mentionTrend, recordMentions, setKv } from "@/lib/server/db";
import { longBars } from "@/lib/server/history";
import type { CoinNarrative, NarrativeChange, NarrativeCoin, NarrativeDetail, NarrativeStage, NarrativeStat, NarrativesResponse, StageValidation } from "@/lib/types";
import { checkStages, type StageTrack } from "./stage-check";
import { faInputsWith, scoreFundamentals, type CategoryKey } from "./fundamentals";
import { isGenericCategory } from "./categories";
import { isDerivativeOrStable } from "./market";
import {
  buildSectorIndex,
  feeGrowthAt,
  feeGrowthLookup,
  countBetween,
  marketFees,
  MIN_MEMBERS,
  narrativeAttention,
  narrativeSignals,
  narrativeStage,
  phaseSeries,
  phaseSince,
  readingAt,
  smooth,
  STAGE_CONFIRM_DAYS,
  STAGE_STRENGTH,
  stageSignals,
  summarizeFees,
  type MarketLaunches,
  type NarrativeBuilders,
  type SectorIndex,
} from "./narrative-rules";

const KEY = "narratives:v12";
const MAX_SECTORS = 24;
/** Coins per sector index (by market cap). */
export const INDEX_MEMBERS = 10;
const EXCLUDE = /stablecoin|wrapped|bridged|liquid staking|restaking|tokenized|usd|exchange-based|centralized exchange/i;
/** Members smaller than this are noise (bad supply data, illiquid pumps). */
const MIN_MEMBER_CAP = 10e6;
const MIN_MEMBER_VOLUME = 200e3;
const HISTORY_WEEKS = 52;
/** Narratives move over weeks, and each rebuild costs ~26 CoinGecko calls, so they're rebuilt at most every 6 hours. */
const TTL = 6 * 60 * MINUTE;
/** Biggest members whose fees are checked for the narrative's fundamental signal. */
export const FEE_MEMBERS = 15;
/** Days of reconstructed stage history (a year, so winners' pre-run stages can be looked up), and how far back changes are reported. */
const STAGE_HISTORY_DAYS = 365;
const CHANGES_DAYS = 30;
const DAY_MS = 86_400_000;
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
const STAGE_ORDER = ["Emerging", "Accelerating", "Quiet", "Maturing", "Fading"];

const pct = (v: number | null | undefined) => (v === null || v === undefined ? null : v / 100);

export interface SectorBuild {
  id: string;
  name: string;
  marketCap: number;
  change24h: number | null;
  /** All qualifying members (up to 50), biggest first. */
  coins: cg.CgMarket[];
  /** Members the index is built from. */
  indexCoins: cg.CgMarket[];
  index: SectorIndex;
  /** Daily fee history for the biggest members DefiLlama tracks (by ticker), with the DefiLlama category or chain each operates in. */
  fees: { symbol: string; series: FlowSeries; category: string | null; chain: string | null }[];
}

type ListingTimes = Awaited<ReturnType<typeof listingTimes>>;

/**
 * New protocols launched, in the 90 days up to `atSec` and the 90 before, in
 * the categories and on the chains a narrative's coins operate in.
 */
export function buildersAt(s: Pick<SectorBuild, "fees">, atSec: number, times: ListingTimes | null): NarrativeBuilders | null {
  if (!times) return null;
  const cats = new Set(s.fees.flatMap((f) => (f.category && f.category !== "Chain" ? [f.category] : [])));
  const chains = new Set(s.fees.flatMap((f) => (f.chain ? [f.chain.toLowerCase()] : [])));
  if (!cats.size && !chains.size) return null;
  const lists = [...[...cats].map((c) => times.byCategory.get(c)), ...[...chains].map((c) => times.byChain.get(c))].filter((l): l is number[] => !!l);
  const DAY = 86_400;
  const count = (from: number, to: number) => lists.reduce((sum, l) => sum + countBetween(l, from, to), 0);
  return { last90: count(atSec - 90 * DAY, atSec), prev90: count(atSec - 180 * DAY, atSec - 90 * DAY) };
}

/** Launches across all of DefiLlama in the same windows. */
export function marketLaunchesAt(atSec: number, times: ListingTimes | null): MarketLaunches | null {
  if (!times) return null;
  const DAY = 86_400;
  return { last90: countBetween(times.all, atSec - 90 * DAY, atSec), prev90: countBetween(times.all, atSec - 180 * DAY, atSec - 90 * DAY) };
}

/** Daily fees for a narrative's biggest coins that DefiLlama tracks. */
async function memberFees(coins: cg.CgMarket[], sources: Awaited<ReturnType<typeof feeSourcesBySymbol>>) {
  const picks = coins.slice(0, FEE_MEMBERS).flatMap((c) => {
    const src = sources.get(c.symbol.toUpperCase());
    return src ? [{ symbol: c.symbol.toUpperCase(), slug: src.slug, category: src.category, chain: src.kind === "chain" ? src.name : null }] : [];
  });
  const series = await Promise.all(picks.map((p) => flowSeries(p.slug, "dailyFees").catch(() => null)));
  return picks.flatMap((p, i) =>
    series[i]?.values.length ? [{ symbol: p.symbol, series: series[i] as FlowSeries, category: p.category, chain: p.chain }] : [],
  );
}

/**
 * A CoinGecko coin's Binance history, if the ticker matches and the prices
 * agree (two different coins can share a ticker).
 */
async function barsFor(coin: cg.CgMarket, pairs: Map<string, unknown>): Promise<DailyBar[] | null> {
  const sym = coin.symbol.toUpperCase();
  if (!pairs.has(sym)) return null;
  const bars = await longBars(sym).catch(() => null);
  const last = bars?.[bars.length - 1]?.close;
  if (!bars || !last || !coin.current_price) return null;
  // Loose on purpose: cached bars can be up to a day old. Ticker clashes are usually off by far more.
  return Math.abs(last / coin.current_price - 1) < 0.3 ? bars : null;
}

/** Sector members and indexes. Shared by the Narratives page and the backtest. */
export const buildSectors = () =>
  cached("narratives:build:v4", TTL, async (): Promise<{ sectors: SectorBuild[]; markets: cg.CgMarket[]; btcBars: DailyBar[] }> => {
    const [categories, markets, pairs, btcBars, sources] = await Promise.all([
      cg.getCategories(),
      cg.getMarkets(),
      spotUsdtPairs(),
      longBars("BTC"),
      feeSourcesBySymbol().catch(() => new Map()),
    ]);
    if (!btcBars?.length) throw new Error("Couldn't load BTC history from Binance");

    const picked = categories
      .filter((c) => (c.market_cap ?? 0) >= 300e6 && !EXCLUDE.test(c.name) && !isGenericCategory(c.name))
      .sort((a, b) => (b.market_cap ?? 0) - (a.market_cap ?? 0))
      .slice(0, MAX_SECTORS);

    const lists = await Promise.allSettled(picked.map((c) => cg.getCategoryMarkets(c.id)));
    const built = await Promise.all(
      picked.map(async (c, i): Promise<SectorBuild | null> => {
        const list = lists[i];
        const coins = (list.status === "fulfilled" ? list.value : []).filter(
          (m) => !isDerivativeOrStable(m) && (m.market_cap ?? 0) >= MIN_MEMBER_CAP && (m.total_volume ?? 0) >= MIN_MEMBER_VOLUME,
        );
        // A few spares, since some top coins aren't on Binance.
        const candidates = coins.slice(0, INDEX_MEMBERS + 6);
        const [bars, fees] = await Promise.all([Promise.all(candidates.map((coin) => barsFor(coin, pairs))), memberFees(coins, sources)]);
        const picks = candidates.flatMap((coin, k) => (bars[k] ? [{ coin, bars: bars[k] as DailyBar[] }] : [])).slice(0, INDEX_MEMBERS);
        if (picks.length < MIN_MEMBERS) return null;
        return {
          id: c.id,
          name: c.name,
          marketCap: c.market_cap ?? 0,
          change24h: pct(c.market_cap_change_24h),
          coins,
          indexCoins: picks.map((p) => p.coin),
          index: buildSectorIndex(
            picks.map((p) => p.bars),
            btcBars,
          ),
          fees,
        };
      }),
    );
    return { sectors: built.filter((s): s is SectorBuild => s !== null), markets, btcBars };
  });

/** Latest narratives: from memory, else from disk if saved within the TTL (so a restart costs nothing), else rebuilt. */
export const getNarratives = () =>
  cachedUntil(KEY, async () => {
    try {
      const saved = await getKv<NarrativesResponse>(KEY);
      const savedAt = saved ? Date.parse(saved.savedAt) : 0;
      if (saved && Date.now() - savedAt < TTL) return { value: saved.value, expires: savedAt + TTL };
    } catch {
      // No saved copy: rebuild.
    }
    return { value: await buildNarratives(), expires: Date.now() + TTL };
  });

async function buildNarratives(): Promise<NarrativesResponse> {
  const [{ sectors, markets }, trending, headlines, launched, flows, times] = await Promise.all([
    buildSectors(),
    cg
      .getTrending()
      .then((t) => new Set(t.categories.map((c) => c.name.toLowerCase())))
      .catch(() => new Set<string>()),
    getNews(null)
      .then((n) => n.items.map((i) => i.title))
      .catch(() => null),
    launches().catch(() => null),
    stablecoinFlows().catch(() => null),
    listingTimes().catch(() => null),
  ]);
  const btc = markets.find((c) => c.id === "bitcoin");
  const toSec = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
  const nowSec = Date.now() / 1000;

  // Market-wide fee growth: every distinct fee-earning coin across all narratives.
  const unique = new Map(sectors.flatMap((s) => s.fees.map((f) => [f.symbol, f.series] as const)));
  const market = marketFees([...unique.values()].map((series) => feeGrowthAt(series.values, series.values.length - 1)));

  // Point-in-time fee growth on any past day (yesterday's data is the latest known), for the stage history.
  const positions = new Map([...unique.values()].map((series) => [series, new Map(series.dates.map((d, i) => [d, i]))]));
  const growthOn = (series: FlowSeries, date: string) => {
    const end = positions.get(series)?.get(dayBefore(date));
    return end === undefined ? { g30: null, g90: null } : feeGrowthAt(series.values, end);
  };
  const historyDays = (sectors[0]?.index.dates ?? []).slice(-STAGE_HISTORY_DAYS);
  const marketOn = new Map(historyDays.map((d) => [d, marketFees([...unique.values()].map((series) => growthOn(series, d)))]));

  // Today's headline mentions are saved first, so each trend includes them.
  const mentionsById = new Map(sectors.map((s) => [s.id, headlines ? countMentions(headlines, s) : null]));
  await Promise.all(
    [...mentionsById].map(([id, mentions]) =>
      mentions === null
        ? null
        : recordMentions(id, mentions).catch(() => {
            // Mention history is a nice-to-have.
          }),
    ),
  );
  const trends = new Map(await Promise.all(sectors.map(async (s) => [s.id, await safeMentionTrend(s.id)] as const)));

  const stats: NarrativeStat[] = sectors.map((s) => {
    const { index } = s;
    const last = index.dates.length - 1;
    const reading = readingAt(index, last);
    const phases = phaseSeries(index);
    const phase = phases[last];
    const fundamentals = summarizeFees(s.fees.map((f) => feeGrowthAt(f.series.values, f.series.values.length - 1)));
    const isTrending = trending.has(s.name.toLowerCase());
    const builders = buildersAt(s, nowSec, times);
    // Stage = fundamentals only (fees vs market, builders). Attention = price vs BTC, shown beside it, never scored.
    const liveStage = narrativeStage(fundamentals, market, builders, marketLaunchesAt(nowSec, times));
    const attention = narrativeAttention(phase, reading, isTrending);
    const mentions = mentionsById.get(s.id) ?? null;
    // Daily stage over the last 90 days, rebuilt from data known on each day, ending with today's.
    const firstDay = Math.max(0, last - STAGE_HISTORY_DAYS + 1);
    const raw: (NarrativeStage | null)[] = [];
    for (let t = firstDay; t < last; t++) {
      const date = index.dates[t];
      const fees = summarizeFees(s.fees.map((f) => growthOn(f.series, date)));
      raw.push(narrativeStage(fees, marketOn.get(date) ?? market, buildersAt(s, toSec(date), times), marketLaunchesAt(toSec(date), times)));
    }
    const stages = smooth([...raw, liveStage], STAGE_CONFIRM_DAYS);
    const stage = stages[stages.length - 1] ?? liveStage;
    const stageDates = index.dates.slice(firstDay, last + 1);
    const stageSince = phaseSince(stageDates, stages);
    const sinceIdx = stageSince ? stageDates.indexOf(stageSince) : -1;
    const previousStage = sinceIdx > 0 ? stages[sinceIdx - 1] : null;

    const from = Math.max(0, last - HISTORY_WEEKS * 7);
    const base = index.level[from] / index.btc[from];
    const history: NarrativeStat["history"] = [];
    for (let t = from; t <= last; t += 7) history.push({ date: index.dates[t], ratio: index.level[t] / index.btc[t] / base, phase: phases[t] });
    if (history[history.length - 1]?.date !== index.dates[last]) history.push({ date: index.dates[last], ratio: index.level[last] / index.btc[last] / base, phase });

    return {
      id: s.id,
      name: s.name,
      marketCap: s.marketCap,
      change24h: s.change24h,
      reading,
      stage,
      attention,
      builders,
      fundamentals,
      mentions,
      mentionTrend: trends.get(s.id) ?? null,
      phase,
      strength: STAGE_STRENGTH[stage],
      since: phaseSince(index.dates, phases),
      stageSince,
      previousStage,
      stageHistory: stageDates.map((date, k) => ({ date, stage: stages[k] })),
      signals: [...stageSignals(stage, fundamentals, builders, marketLaunchesAt(nowSec, times), mentions), ...(phase ? narrativeSignals(phase, reading) : [])],
      trending: isTrending,
      history,
      members: s.indexCoins.map((m) => ({
        id: m.id,
        symbol: m.symbol.toUpperCase(),
        name: m.name,
        image: m.image,
        change30d: pct(m.price_change_percentage_30d_in_currency),
      })),
    };
  });

  // Every stage change in the last 30 days, across narratives.
  const cutoff = new Date(Date.now() - CHANGES_DAYS * DAY_MS).toISOString().slice(0, 10);
  const changes: NarrativeChange[] = stats.flatMap((s) =>
    s.stageHistory.flatMap((h, k) => {
      const prev = s.stageHistory[k - 1]?.stage ?? null;
      return k > 0 && h.stage && h.stage !== prev && h.date >= cutoff ? [{ id: s.id, sector: s.name, from: prev, to: h.stage, date: h.date }] : [];
    }),
  );

  const res: NarrativesResponse = {
    changes: changes.sort((a, b) => b.date.localeCompare(a.date)),
    builders: {
      categories: (launched?.categories ?? []).filter((c) => c.last90 + c.prev90 >= 3).slice(0, 12),
      chains: (flows?.flows ?? []).slice(0, 15).map((f) => {
        const l = launched?.byChain.get(f.chain.toLowerCase());
        return { name: f.chain, last90: l?.last90 ?? 0, prev90: l?.prev90 ?? 0, stablecoins: f.current, stablecoinChange30d: f.change30d };
      }),
    },
    sectors: stats.sort(
      (a, b) => STAGE_ORDER.indexOf(a.stage ?? "") - STAGE_ORDER.indexOf(b.stage ?? "") || (b.fundamentals.feeGrowth90d ?? -9) - (a.fundamentals.feeGrowth90d ?? -9),
    ),
    btc: { d7: pct(btc?.price_change_percentage_7d_in_currency), d30: pct(btc?.price_change_percentage_30d_in_currency) },
    marketFees: market,
    updatedAt: new Date().toISOString(),
  };
  try {
    await setKv(KEY, res);
  } catch (err) {
    console.warn("[narratives] save:", err instanceof Error ? err.message : err);
  }
  return res;
}

/** Saved narratives are good enough for coin profiles for a day; never triggers the slow load. */
const SAVED_MAX_AGE = 24 * 60 * MINUTE;

export async function latestNarratives(): Promise<NarrativesResponse | null> {
  const live = peek<NarrativesResponse>(KEY);
  if (live) return live;
  try {
    const saved = await getKv<NarrativesResponse>(KEY);
    return saved && Date.now() - Date.parse(saved.savedAt) < SAVED_MAX_AGE ? saved.value : null;
  } catch {
    return null;
  }
}

/** A coin's strongest tracked narrative among its categories; `loaded` is false when no narrative data is available yet. */
export async function narrativeFor(categories: string[]): Promise<{ loaded: boolean; narrative: CoinNarrative | null }> {
  const data = await latestNarratives();
  return { loaded: data !== null, narrative: data ? strongest(data, categories) : null };
}

/** A coin's strongest narrative stage on a past date (within the 90-day stage history of `data` from latestNarratives()), or null. */
export function narrativeAt(data: NarrativesResponse | null, categories: string[], date: string): { sector: string; stage: NarrativeStage } | null {
  if (!data) return null;
  const mine = new Set(categories.map((c) => c.toLowerCase()));
  const options = data.sectors.flatMap((s) => {
    const stage = mine.has(s.name.toLowerCase()) ? s.stageHistory?.find((h) => h.date === date)?.stage : null;
    return stage ? [{ sector: s.name, stage }] : [];
  });
  return options.sort((a, b) => STAGE_STRENGTH[b.stage] - STAGE_STRENGTH[a.stage])[0] ?? null;
}

function strongest(data: NarrativesResponse, categories: string[]): CoinNarrative | null {
  const mine = new Set(categories.map((c) => c.toLowerCase()));
  const best = data.sectors
    .filter((s) => mine.has(s.name.toLowerCase()) && s.phase && s.stage && s.strength !== null)
    .sort((a, b) => (b.strength as number) - (a.strength as number))[0];
  if (!best?.phase || !best.stage) return null;
  return {
    sector: best.name,
    stage: best.stage,
    attention: best.attention ?? "Unnoticed",
    phase: best.phase,
    strength: best.strength as number,
    rel30: best.reading.rel30,
    rel7: best.reading.rel7,
    since: best.since,
  };
}

const STOP = new Set(["and", "the", "of", "protocol", "protocols", "themed", "coins", "coin", "token", "tokens", "sector"]);

/** Words that name a narrative in headlines: "Artificial Intelligence (AI)" → "ai", "artificial intelligence". */
function keywords(name: string): string[] {
  const out = new Set<string>();
  const abbr = name.match(/\(([^)]+)\)/)?.[1];
  if (abbr) out.add(abbr.toLowerCase());
  const base = name.replace(/\([^)]*\)/g, "").trim().toLowerCase();
  if (!base.split(/\s+/).every((w) => STOP.has(w))) out.add(base.replace(/-themed$/, "").trim());
  return [...out].filter((k) => k.length >= 2);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Headlines mentioning the narrative's name or one of its index coins. */
/** A test for whether a headline mentions the narrative or one of its index coins. */
function mentionMatcher(s: SectorBuild): (headline: string) => boolean {
  const terms = [
    ...keywords(s.name),
    ...s.indexCoins.map((c) => c.name.toLowerCase()).filter((n) => n.length >= 4),
  ];
  const patterns = terms.map((t) => new RegExp(`\\b${escape(t)}\\b`, "i"));
  const symbols = s.indexCoins.map((c) => c.symbol.toUpperCase()).filter((sym) => sym.length >= 3 && /^[A-Z0-9]+$/.test(sym)).map((sym) => new RegExp(`\\b${sym}\\b`));
  return (h) => patterns.some((p) => p.test(h)) || symbols.some((p) => p.test(h));
}

/** Headlines mentioning the narrative's name or one of its index coins. */
function countMentions(headlines: string[], s: SectorBuild): number {
  return headlines.filter(mentionMatcher(s)).length;
}

async function safeMentionTrend(id: string) {
  try {
    return await mentionTrend(id);
  } catch {
    return null;
  }
}

// ---- One narrative in depth ----

/** Scorecard categories a quick score can fill from DefiLlama data and the narrative itself. */
const QUICK_BASE: CategoryKey[] = ["narrative", "adoption", "valueCapture", "valuation"];
const ANNUALIZE_30D = 365 / 30;

async function quickCoin(coin: cg.CgMarket, s: SectorBuild, stat: NarrativeStat, sources: Awaited<ReturnType<typeof feeSourcesBySymbol>> | null): Promise<NarrativeCoin> {
  const src = sources?.get(coin.symbol.toUpperCase());
  const [fees, revenue, holders] = src
    ? await Promise.all((["dailyFees", "dailyRevenue", "dailyHoldersRevenue"] as const).map((t) => flowSeries(src.slug, t).catch(() => null)))
    : [null, null, null];
  const last30 = (f: FlowSeries | null) => (f && f.values.length >= 30 ? f.values.slice(-30).reduce((a, b) => a + b, 0) : null);
  const f30 = last30(fees);
  const hasFees = f30 !== null && f30 > 0;
  const g = hasFees && fees ? feeGrowthAt(fees.values, fees.values.length - 1) : { g30: null, g90: null };
  const share = (x: number | null) => (hasFees && x !== null ? Math.min(1, x / (f30 as number)) : null);
  const h30 = last30(holders);
  const mcap = coin.market_cap ?? null;
  const priceToFees = hasFees && mcap ? mcap / ((f30 as number) * ANNUALIZE_30D) : null;
  const holderShare = hasFees ? (share(h30) ?? 0) : null;
  const quick = scoreFundamentals(
    faInputsWith({
      hasFees,
      feesGrowth30d: g.g30,
      feesGrowth90d: g.g90,
      feesAnnualized: hasFees ? (f30 as number) * ANNUALIZE_30D : null,
      holderShare,
      revenueShare: share(last30(revenue)),
      holdersRevenueAnnualized: h30 ? h30 * ANNUALIZE_30D : null,
      priceToFees,
      narrative: stat.stage ? { sector: stat.name, stage: stat.stage, strength: stat.strength ?? 0 } : null,
    }),
    { evidenceBase: QUICK_BASE },
  );
  return {
    id: coin.id,
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
    image: coin.image,
    marketCap: mcap,
    change30d: pct(coin.price_change_percentage_30d_in_currency),
    inIndex: s.indexCoins.some((c) => c.id === coin.id),
    hasFees,
    fees30d: hasFees ? f30 : null,
    feesGrowth30d: g.g30,
    feesGrowth90d: g.g90,
    holderShare,
    priceToFees,
    quickScore: quick.score,
  };
}

/** One narrative in depth: its coins ranked by fundamentals, where its builder counts come from, and its headlines. */
export const narrativeDetail = (id: string) =>
  cached(`narrative-detail:v3:${id}`, 30 * MINUTE, async (): Promise<NarrativeDetail | null> => {
    const [data, { sectors }, sources, times, news, check] = await Promise.all([
      getNarratives(),
      buildSectors(),
      feeSourcesBySymbol().catch(() => null),
      listingTimes().catch(() => null),
      getNews(null).catch(() => null),
      stageCheck().catch(() => null),
    ]);
    const stat = data.sectors.find((x) => x.id === id);
    const s = sectors.find((x) => x.id === id);
    if (!stat || !s) return null;

    const coins = await Promise.all(s.coins.map((c) => quickCoin(c, s, stat, sources)));
    coins.sort((a, b) => Number(b.hasFees) - Number(a.hasFees) || (b.quickScore ?? -1) - (a.quickScore ?? -1));

    const now = Date.now() / 1000;
    const DAY = 86_400;
    const count = (list: number[] | undefined) =>
      list ? { last90: countBetween(list, now - 90 * DAY, now), prev90: countBetween(list, now - 180 * DAY, now - 90 * DAY) } : { last90: 0, prev90: 0 };
    const cats = [...new Set(s.fees.flatMap((f) => (f.category && f.category !== "Chain" ? [f.category] : [])))];
    const chains = [...new Set(s.fees.flatMap((f) => (f.chain ? [f.chain] : [])))];
    const builderSources = [
      ...cats.map((name) => ({ name, kind: "category" as const, ...count(times?.byCategory.get(name)) })),
      ...chains.map((name) => ({ name, kind: "chain" as const, ...count(times?.byChain.get(name.toLowerCase())) })),
    ].sort((a, b) => b.last90 - a.last90);

    const mentions = mentionMatcher(s);
    return {
      stat,
      coins,
      builderSources,
      headlines: (news?.items ?? []).filter((n) => mentions(n.title)),
      marketFees: data.marketFees,
      track: check?.tracks.find((t) => t.id === id) ?? null,
      stageResults: check?.stages ?? null,
    };
  });

// ---- Stage check: replay every narrative's stage over its whole history ----

/** Raw daily stage for every narrative since its index began, from data known on each day (null before any fee or builder data). */
async function stageTracks(): Promise<StageTrack[]> {
  const [{ sectors }, times] = await Promise.all([buildSectors(), listingTimes().catch(() => null)]);
  const lookups = new Map([...new Map(sectors.flatMap((s) => s.fees.map((f) => [f.symbol, f.series] as const))).values()].map((series) => [series, feeGrowthLookup(series)]));
  const dates = sectors[0]?.index.dates ?? [];
  const market = dates.map((d) => marketFees([...lookups.values()].map((growth) => growth(d))));
  const toSec = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;
  return sectors.map((s) => ({
    id: s.id,
    name: s.name,
    dates: s.index.dates,
    level: s.index.level,
    btc: s.index.btc,
    members: s.index.members,
    stages: s.index.dates.map((d, t) => {
      const fees = summarizeFees(s.fees.map((f) => (lookups.get(f.series) as (date: string) => { g30: number | null; g90: number | null })(d)));
      const builders = buildersAt(s, toSec(d), times);
      if (fees.feeGrowth30d === null && fees.feeGrowth90d === null && !builders) return null;
      return narrativeStage(fees, market[t], builders, marketLaunchesAt(toSec(d), times));
    }),
  }));
}

/** Does the stage work? Stability and what followed each stage change, across every narrative's history. */
export const stageCheck = () =>
  cached("narratives:stage-check:v3", TTL, async (): Promise<StageValidation> => {
    const result = checkStages(await stageTracks());
    return {
      ...result,
      notes: [
        "Each day's stage uses only data known that morning (fees up to the day before, protocol listings up to that day), smoothed exactly like the live page.",
        "Results are each narrative's equal-weighted index of its top coins relative to BTC, and relative to the median tracked narrative over the same days (a stage with no signal lands near 0% and beats it about half the time). Medians, so one huge run can't carry a stage.",
        "Narratives and their coins are today's lists: sectors that did well are more likely to be tracked now, which flatters the past a little.",
        "Many narratives often change stage in the same weeks (the whole market moves), so calls aren't independent; treat small differences as noise.",
        "Before about 2022, DefiLlama was still adding older protocols, so early builder counts are rougher (they're compared with DefiLlama's overall pace, which offsets most of it).",
      ],
      updatedAt: new Date().toISOString(),
    };
  });
