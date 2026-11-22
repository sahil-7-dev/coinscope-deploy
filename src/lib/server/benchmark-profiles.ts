// Profiles for benchmark coins: saved Library entries already hold a year of
// prices, so only coins that aren't saved get analyzed (which costs API calls).

import { buildProfiles } from "@/lib/analysis/profile";
import { cryptoProvider } from "@/lib/providers/crypto";
import type { CoinProfile } from "@/lib/types";
import { getReference } from "./db";

export async function benchmarkProfiles(ids: string[]): Promise<Map<string, CoinProfile>> {
  const profiles = new Map<string, CoinProfile>();
  for (const id of ids) {
    const saved = (await getReference(id))?.profile;
    if (saved?.series?.length) profiles.set(id, saved);
  }
  const missing = ids.filter((id) => !profiles.has(id));
  if (missing.length) for (const p of (await buildProfiles(cryptoProvider, missing)).profiles) profiles.set(p.id, p);
  return profiles;
}
