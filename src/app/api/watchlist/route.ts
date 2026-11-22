import { connection, type NextRequest } from "next/server";
import { addToWatchlist, listWatchlist, removeFromWatchlist } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";

/** GET → watchlist coins with their recorded score history. */
export async function GET() {
  await connection();
  try {
    return Response.json({ items: await listWatchlist() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { id, name, symbol, image? } → adds a coin. */
export async function POST(req: NextRequest) {
  try {
    const coin = (await req.json()) as { id?: string; name?: string; symbol?: string; image?: string | null };
    if (!coin.id || !coin.name || !coin.symbol) return Response.json({ error: "Missing id, name or symbol" }, { status: 400 });
    await addToWatchlist({ id: coin.id, name: coin.name, symbol: coin.symbol, image: coin.image });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    await removeFromWatchlist(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
