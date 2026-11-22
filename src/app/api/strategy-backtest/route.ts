import { connection, type NextRequest } from "next/server";
import { LATEST_KEY, runStrategyBacktest } from "@/lib/analysis/strategy-backtest";
import { getKv } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { getJob, startJob } from "@/lib/server/jobs";
import type { StrategyBacktestResult, StrategyOptions } from "@/lib/types";

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

/** GET ?id=… → job progress/result. GET alone → the latest saved result (or null). */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const job = getJob<StrategyBacktestResult>(id);
      return job ? Response.json(job) : Response.json({ error: "Backtest not found (the server may have restarted)" }, { status: 404 });
    }
    return Response.json({ latest: (await getKv<StrategyBacktestResult>(LATEST_KEY))?.value ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { horizonDays, threshold, cost, maxCoins } → starts a backtest job (or returns the one already running). */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<StrategyOptions>;
    const opts: StrategyOptions = {
      horizonDays: Math.round(clamp(body.horizonDays, 14, 180, 60)),
      threshold: Math.round(clamp(body.threshold, 1, 100, 60)),
      cost: clamp(body.cost, 0, 0.05, 0.005),
      maxCoins: Math.round(clamp(body.maxCoins, 0, 1000, 300)),
    };
    const job = startJob("strategy-backtest", (report) => runStrategyBacktest(opts, report));
    return Response.json({ id: job.id, status: job.status });
  } catch (err) {
    return errorResponse(err);
  }
}
