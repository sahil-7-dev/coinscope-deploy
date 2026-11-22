import { connection, type NextRequest } from "next/server";
import { closeBuy, journal, JournalError, logDecision } from "@/lib/server/journal";
import { deleteDecision } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";

const fail = (err: unknown) => (err instanceof JournalError ? Response.json({ error: err.message }, { status: 400 }) : errorResponse(err));

/** GET → every decision with its result vs BTC so far, and the summary. */
export async function GET() {
  await connection();
  try {
    return Response.json(await journal());
  } catch (err) {
    return fail(err);
  }
}

/** POST { coinId, action: "buy" | "pass", decidedOn?, price?, note? } → logs a decision with what the app says about the coin now. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { coinId?: string; action?: "buy" | "pass"; decidedOn?: string; price?: number | null; note?: string };
    if (!body.coinId || !body.action) return Response.json({ error: "Missing coinId or action" }, { status: 400 });
    return Response.json({ decision: await logDecision({ coinId: body.coinId, action: body.action, decidedOn: body.decidedOn, price: body.price, note: body.note }) });
  } catch (err) {
    return fail(err);
  }
}

/** PATCH { id, closedOn?, price?, reopen? } → marks a buy as sold (today's price by default), or reopens it. */
export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: number; closedOn?: string; price?: number | null; reopen?: boolean };
    if (!body.id) return Response.json({ error: "Missing id" }, { status: 400 });
    await closeBuy(body.id, body);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = Number(req.nextUrl.searchParams.get("id"));
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    await deleteDecision(id);
    return Response.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
