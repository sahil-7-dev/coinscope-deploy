// Builds a full CoinProfile (metrics, technicals, fundamentals, liquidity,
// derivatives, rally, drivers, red flags and investment scores) from a provider.

import type { AssetProvider } from "@/lib/providers/types";
import type { CoinProfile, PricePoint, ProfilesResponse } from "@/lib/types";
import { recordSnapshot } from "@/lib/server/db";
import { trackThesis } from "@/lib/server/thesis-log";
import { projectLinks } from "@/lib/providers/defillama";
import { devActivity } from "@/lib/providers/github";
import { governance, guessSpaces } from "@/lib/providers/snapshot";
import { unlocksFor } from "@/lib/providers/alphagrowth";
import { holderConcentration } from "@/lib/providers/holders";
import { detectDrivers, detectRedFlags, type ProfileCore } from "./drivers";
import { computeScores } from "./scores";
import { verdictFor } from "./verdict";
import { narrativeFor } from "./narratives";
import { detectRally, snapshotAt, supplyInflation, technicals, volatility, type BenchmarkCloses } from "./series";

export const HISTORY_DAYS = 365;
const DAY = 86_400_000;

/** Optional data never fails a profile; it just comes back empty. */
const optional = <T>(p: Promise<T>, label: string): Promise<T | null> =>
  p.catch((err) => {
    console.warn(`[profile] ${label}:`, err instanceof Error ? err.message : err);
    return null;
  });

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Charts are cached for up to a day, so today's bar gets the live price: updated
 * if the chart already has today, added if the cached chart ends yesterday.
 */
function withLivePrice(series: PricePoint[], live: { price: number; marketCap: number | null; volume: number | null }): PricePoint[] {
  const last = series[series.length - 1];
  if (!last || !(live.price > 0)) return series;
  if (last.date === today()) return [...series.slice(0, -1), { ...last, price: live.price, marketCap: live.marketCap ?? last.marketCap }];
  if (last.date < today()) return [...series, { date: today(), price: live.price, volume: live.volume ?? last.volume, marketCap: live.marketCap ?? last.marketCap }];
  return series;
}

export async function getBenchmark(provider: AssetProvider): Promise<BenchmarkCloses> {
  const [bars, details] = await Promise.all([
    provider.getDailyBars(provider.benchmarkId, HISTORY_DAYS),
    provider.getDetails(provider.benchmarkId).catch(() => null),
  ]);
  const series = bars.map((b) => ({ date: b.date, price: b.close, volume: b.volume, marketCap: b.marketCap }));
  const current = details ? withLivePrice(series, { price: details.price, marketCap: details.marketCap, volume: details.volume24h }) : series;
  return new Map(current.map((b) => [b.date, b.price]));
}

export async function buildProfiles(provider: AssetProvider, ids: string[]): Promise<ProfilesResponse> {
  const [bench, trendingCats, trendingIds] = await Promise.all([
    getBenchmark(provider),
    provider.getTrendingCategories().catch(() => [] as string[]),
    provider.getTrendingIds().catch(() => [] as string[]),
  ]);
  const trending = { categories: new Set(trendingCats.map((t) => t.toLowerCase())), ids: new Set(trendingIds) };

  const settled = await Promise.allSettled(ids.map((id) => buildProfile(provider, id, bench, trending)));
  const res: ProfilesResponse = { profiles: [], errors: [] };
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") res.profiles.push(s.value);
    else res.errors.push({ id: ids[i], message: s.reason instanceof Error ? s.reason.message : String(s.reason) });
  });
  return res;
}

async function buildProfile(
  provider: AssetProvider,
  id: string,
  bench: BenchmarkCloses,
  trending: { categories: Set<string>; ids: Set<string> },
): Promise<CoinProfile> {
  const [details, bars, liquidity] = await Promise.all([
    provider.getDetails(id),
    provider.getDailyBars(id, HISTORY_DAYS),
    optional(provider.getLiquidity(id), `liquidity ${id}`),
  ]);
  if (bars.length < 15) throw new Error(`${details.name}: not enough price history to analyze`);
  const links = (await projectLinks().catch(() => null))?.get(id);
  const [derivatives, dev, gov, unlocks, holders] = await Promise.all([
    optional(provider.getDerivatives(details.symbol, details.price), `derivatives ${id}`),
    optional(devActivity(details.about?.github ?? null, links?.github ?? []), `github ${id}`),
    optional(governance([...(links?.snapshot ?? []), ...guessSpaces(details.name, details.symbol)]), `snapshot ${id}`),
    optional(unlocksFor(details.id, details.supply.circulating), `unlocks ${id}`),
    optional(holderConcentration(details.id, details.contracts, details.homePlatform), `holders ${id}`),
  ]);

  const series = withLivePrice(
    bars.map((b) => ({ date: b.date, price: b.close, volume: b.volume, marketCap: b.marketCap })),
    { price: details.price, marketCap: details.marketCap, volume: details.volume24h },
  );
  const now = snapshotAt(series, series.length - 1, bench);
  const found = detectRally(series, bench);
  const { circulating, total, max } = details.supply;
  const supplyCap = max ?? total;
  const circulatingRatio = circulating && supplyCap ? Math.min(1, circulating / supplyCap) : null;
  const genesisAge = details.genesisDate ? Math.round((Date.now() - Date.parse(details.genesisDate)) / DAY) : null;
  const narrative = await narrativeFor(details.categories);

  const core: ProfileCore = {
    ...details,
    supply: { ...details.supply, circulatingRatio },
    trendingCategories: details.categories.filter((c) => trending.categories.has(c.toLowerCase())),
    trendingCoin: trending.ids.has(details.id),
    technicals: technicals(series, bench),
    tokenomics: {
      circulatingRatio,
      fdvToMcap: details.fdv && details.marketCap ? details.fdv / details.marketCap : null,
      inflationAnnual: supplyInflation(series),
    },
    liquidity,
    derivatives,
    devActivity: dev,
    governance: gov,
    unlocks,
    holders,
    // Newer than our history window → its first price is roughly its listing date.
    ageDays: genesisAge && genesisAge > 0 ? genesisAge : series.length < HISTORY_DAYS - 5 ? series.length : null,
    narrative: narrative.narrative,
    narrativeLoaded: narrative.loaded,
    benchmark: provider.benchmarkLabel,
    volatility30d: volatility(series, 30),
    historyDays: series.length,
    series,
    now,
    rally: found?.rally ?? null,
    setup: found ? snapshotAt(series, found.breakoutIndex, bench) : now,
    fetchedAt: new Date().toISOString(),
  };

  const profile: CoinProfile = { ...core, drivers: detectDrivers(core), redFlags: detectRedFlags(core), scores: computeScores(core) };
  try {
    await recordSnapshot(profile, verdictFor(profile).kind);
    // Your thesis checks run on every fresh analysis, so a broken assumption is noticed (and logged) wherever you look.
    await trackThesis(profile);
  } catch (err) {
    console.warn("[profile] snapshot:", err instanceof Error ? err.message : err);
  }
  return profile;
}
