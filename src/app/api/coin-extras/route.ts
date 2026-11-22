import { connection, type NextRequest } from "next/server";
import { coinExtras } from "@/lib/providers/alphagrowth";
import { errorResponse } from "@/lib/server/http";

/** GET ?id=&name=&symbol=&mcap= → funding rounds, investors and community growth (AlphaGrowth). Context for the coin page; nothing is scored. */
export async function GET(req: NextRequest) {
  await connection();
  const q = req.nextUrl.searchParams;
  const id = q.get("id");
  const name = q.get("name");
  const symbol = q.get("symbol");
  if (!id || !name || !symbol) return Response.json({ error: "Missing id, name or symbol" }, { status: 400 });
  try {
    const mcap = Number(q.get("mcap"));
    return Response.json(await coinExtras({ id, name, symbol, marketCap: mcap > 0 ? mcap : null }));
  } catch (err) {
    return errorResponse(err);
  }
}
