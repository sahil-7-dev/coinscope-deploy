import { buildProfiles } from "@/lib/analysis/profile";
import { verdictFor } from "@/lib/analysis/verdict";
import { cryptoProvider } from "@/lib/providers/crypto";
import { listWatchlist, recordSnapshot } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";

const CHUNK = 20;
/** A manual refresh may record a new point sooner than the automatic 6-hour spacing. */
const MANUAL_INTERVAL_MS = 30 * 60_000;

/** POST → re-analyzes every watchlist coin (recording a score snapshot) and returns the profiles without price series. */
export async function POST() {
  try {
    const ids = (await listWatchlist()).map((w) => w.id);
    const profiles = [];
    const errors = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await buildProfiles(cryptoProvider, ids.slice(i, i + CHUNK));
      for (const p of res.profiles) await recordSnapshot(p, verdictFor(p).kind, MANUAL_INTERVAL_MS);
      profiles.push(...res.profiles.map((p) => ({ ...p, series: [] })));
      errors.push(...res.errors);
    }
    return Response.json({ profiles, errors });
  } catch (err) {
    return errorResponse(err);
  }
}
