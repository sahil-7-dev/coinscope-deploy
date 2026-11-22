import { connection, type NextRequest } from "next/server";
import { preMove, type PreMove } from "@/lib/analysis/winner-pattern";
import { benchmarkProfiles } from "@/lib/server/benchmark-profiles";
import { getBenchmarkChoices } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";

const MAX_IDS = 12;

/** GET ?ids=a,b → each benchmark's fundamentals before its chosen run (or your chosen date), and at the run's peak. */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_IDS);
    if (!ids.length) return Response.json({ results: [] });
    const profiles = await benchmarkProfiles(ids);
    const choices = await getBenchmarkChoices(ids);
    const results: PreMove[] = [];
    for (const id of ids) {
      const p = profiles.get(id);
      const r = p
        ? await preMove(p, choices[id] ?? null).catch((err) => {
            console.warn(`[winner-pattern] ${id}:`, err instanceof Error ? err.message : err);
            return null;
          })
        : null;
      results.push(r ?? { id, run: null, before: null, atPeak: null, custom: false, note: "Couldn't analyze this coin." });
    }
    return Response.json({ results });
  } catch (err) {
    return errorResponse(err);
  }
}
