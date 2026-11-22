import type { NextRequest } from "next/server";
import { buildProfiles } from "@/lib/analysis/profile";
import { cryptoProvider } from "@/lib/providers/crypto";
import { errorResponse } from "@/lib/server/http";

const MAX_IDS = 20;

/** GET /api/profiles?ids=solana,render-token → full analysis for each coin. */
export async function GET(req: NextRequest) {
  const ids = [
    ...new Set(
      (req.nextUrl.searchParams.get("ids") ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (!ids.length) return Response.json({ error: "Pass at least one coin id in ?ids=" }, { status: 400 });
  if (ids.length > MAX_IDS) return Response.json({ error: `At most ${MAX_IDS} coins per request` }, { status: 400 });

  try {
    return Response.json(await buildProfiles(cryptoProvider, ids));
  } catch (err) {
    return errorResponse(err);
  }
}
