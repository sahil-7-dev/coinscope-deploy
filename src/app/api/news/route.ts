import type { NextRequest } from "next/server";
import { getNews } from "@/lib/providers/news";
import { errorResponse } from "@/lib/server/http";

/** GET /api/news?name=Solana&symbol=SOL → coin headlines; no params → latest market headlines. */
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name")?.trim();
  const symbol = req.nextUrl.searchParams.get("symbol")?.trim();
  try {
    return Response.json(await getNews(name && symbol ? { name, symbol } : null));
  } catch (err) {
    return errorResponse(err);
  }
}
