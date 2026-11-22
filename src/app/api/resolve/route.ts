import type { NextRequest } from "next/server";
import { cryptoProvider } from "@/lib/providers/crypto";
import { errorResponse } from "@/lib/server/http";
import type { SearchResult } from "@/lib/types";

const MAX_TOKENS = 20;

/**
 * GET /api/resolve?q=SUI, render, Fetch.ai → turns a pasted list of tickers or names into coins.
 * Prefers an exact ticker or name match, and among those the highest-ranked coin.
 */
export async function GET(req: NextRequest) {
  const tokens = [
    ...new Set(
      (req.nextUrl.searchParams.get("q") ?? "")
        .split(/[,\n;\t]+/)
        .map((s) => s.trim().replace(/^\$/, ""))
        .filter(Boolean),
    ),
  ].slice(0, MAX_TOKENS);

  try {
    const results = await Promise.all(
      tokens.map(async (token) => {
        const found = await cryptoProvider.search(token).catch(() => [] as SearchResult[]);
        const t = token.toLowerCase();
        const exact = found.filter((c) => c.symbol.toLowerCase() === t || c.name.toLowerCase() === t || c.id === t);
        const pool = exact.length ? exact : found;
        const best = [...pool].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))[0];
        return { token, coin: best ?? null };
      }),
    );
    return Response.json({
      resolved: results.filter((r) => r.coin).map((r) => ({ token: r.token, coin: r.coin })),
      unresolved: results.filter((r) => !r.coin).map((r) => r.token),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
