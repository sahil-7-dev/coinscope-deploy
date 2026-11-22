import { connection, type NextRequest } from "next/server";
import { winnerDetail } from "@/lib/analysis/winner-pattern";
import { benchmarkProfiles } from "@/lib/server/benchmark-profiles";
import { getBenchmarkChoices, saveBenchmarkChoice } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET ?id=x → the coin's runs since 2021 and its fundamentals before the chosen run.
 * &asOf=YYYY-MM-DD previews another date without saving it.
 */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const id = req.nextUrl.searchParams.get("id")?.trim();
    if (!id) return Response.json({ error: "Missing coin id" }, { status: 400 });
    const preview = req.nextUrl.searchParams.get("asOf");
    const saved = (await getBenchmarkChoices([id]))[id] ?? null;
    const p = (await benchmarkProfiles([id])).get(id);
    if (!p) return Response.json({ error: "Couldn't analyze this coin" }, { status: 502 });
    const detail = await winnerDetail(p, preview && DATE.test(preview) ? preview : saved);
    return Response.json({ detail, saved, name: p.name, symbol: p.symbol, image: p.image });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { id, asOf } → saves the date this benchmark is compared as of (null = back to its default run). */
export async function POST(req: NextRequest) {
  try {
    const { id, asOf } = (await req.json()) as { id?: string; asOf?: string | null };
    if (!id) return Response.json({ error: "Missing coin id" }, { status: 400 });
    if (asOf !== null && asOf !== undefined && !DATE.test(asOf)) return Response.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
    await saveBenchmarkChoice(id, asOf ?? null);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
