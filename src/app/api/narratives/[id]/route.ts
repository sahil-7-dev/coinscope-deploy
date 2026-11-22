import { connection } from "next/server";
import { narrativeDetail } from "@/lib/analysis/narratives";
import { errorResponse } from "@/lib/server/http";

/** GET /api/narratives/:id → one narrative in depth: its coins ranked by fundamentals, builder sources, headlines. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await params;
    const detail = await narrativeDetail(decodeURIComponent(id));
    return detail ? Response.json(detail) : Response.json({ error: "Narrative not found (it may have dropped out of the tracked list)" }, { status: 404 });
  } catch (err) {
    return errorResponse(err);
  }
}
