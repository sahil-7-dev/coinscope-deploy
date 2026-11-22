import type { NextRequest } from "next/server";
import { buildProfiles } from "@/lib/analysis/profile";
import { cryptoProvider } from "@/lib/providers/crypto";
import { deleteReference, getReference, listReferences, saveReference, updateReferenceNote } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";

/** GET /api/library → all saved references (without price series); ?id=x → one, with series. */
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (id) {
      const entry = await getReference(id);
      return entry ? Response.json(entry) : Response.json({ error: "Not in library" }, { status: 404 });
    }
    return Response.json({ entries: await listReferences() });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST { id, note? } → analyzes the coin fresh and saves (or overwrites) it as a reference. */
export async function POST(req: NextRequest) {
  try {
    const { id, note = "" } = (await req.json()) as { id?: string; note?: string };
    if (!id) return Response.json({ error: "Missing coin id" }, { status: 400 });
    const res = await buildProfiles(cryptoProvider, [id]);
    if (!res.profiles.length) return Response.json({ error: res.errors[0]?.message ?? "Analysis failed" }, { status: 502 });
    return Response.json(await saveReference(res.profiles[0], note));
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH { id, note } → edits a reference's note. */
export async function PATCH(req: NextRequest) {
  try {
    const { id, note } = (await req.json()) as { id?: string; note?: string };
    if (!id || note === undefined) return Response.json({ error: "Missing id or note" }, { status: 400 });
    await updateReferenceNote(id, note);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    await deleteReference(id);
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
