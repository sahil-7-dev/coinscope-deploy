import type { NextRequest } from "next/server";
import { runBacktest } from "@/lib/analysis/backtest";
import { isDerivativeOrStable } from "@/lib/analysis/market";
import * as cg from "@/lib/providers/coingecko";
import { cryptoProvider } from "@/lib/providers/crypto";
import { errorResponse } from "@/lib/server/http";
import type { Checklist } from "@/lib/types";

const MAX_COINS = 40;

/**
 * POST { checklist, ids, topN?, horizonDays?, threshold? }
 * Backtests the checklist over the given coins plus, optionally, the top N coins by market cap.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      checklist?: Checklist;
      ids?: string[];
      names?: Record<string, string>;
      topN?: number;
      horizonDays?: number;
      threshold?: number;
    };
    if (!body.checklist?.items?.length) return Response.json({ error: "Missing checklist" }, { status: 400 });

    const horizonDays = Math.min(90, Math.max(7, Math.round(body.horizonDays ?? 30)));
    const threshold = Math.min(100, Math.max(1, Math.round(body.threshold ?? 75)));
    const ids = new Set((body.ids ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean));

    const names: Record<string, string> = { ...body.names };
    const topN = Math.min(MAX_COINS, Math.max(0, Math.round(body.topN ?? 0)));
    if (topN) {
      const markets = await cg.getMarkets();
      for (const c of markets.filter((m) => !isDerivativeOrStable(m) && m.id !== "bitcoin").slice(0, topN)) {
        ids.add(c.id);
        names[c.id] = c.name;
      }
    }
    if (!ids.size) return Response.json({ error: "Pick coins to test on, or include top coins" }, { status: 400 });

    return Response.json(await runBacktest(cryptoProvider, body.checklist, [...ids].slice(0, MAX_COINS), horizonDays, threshold, names));
  } catch (err) {
    return errorResponse(err);
  }
}
