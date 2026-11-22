import type { NextRequest } from "next/server";
import { cryptoProvider } from "@/lib/providers/crypto";
import { errorResponse } from "@/lib/server/http";
import { MIN_SEARCH } from "@/lib/format";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < MIN_SEARCH) return Response.json({ results: [] });
  try {
    return Response.json({ results: await cryptoProvider.search(q) });
  } catch (err) {
    return errorResponse(err);
  }
}
