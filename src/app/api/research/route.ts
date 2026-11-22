import { connection, type NextRequest } from "next/server";
import { CHECK_METRICS } from "@/lib/analysis/thesis";
import { getResearch, listThesisEvents, saveResearch } from "@/lib/server/db";
import { errorResponse } from "@/lib/server/http";
import { logThesisChanges } from "@/lib/server/thesis-log";
import type { Assumption, CheckMetric, CoinResearch, EvidenceTag, NarrativeStage, ThesisEvent } from "@/lib/types";

const RATINGS = ["useCase", "moat", "team", "ambition", "feasibility"] as const;
const NOTES = ["problem", "unique", "tokenValue", "competitors", "bull", "base", "bear", "catalysts", "invalidation"] as const;
const STAGES: NarrativeStage[] = ["Emerging", "Accelerating", "Quiet", "Maturing", "Fading"];
const MAX_ASSUMPTIONS = 12;
const MAX_SOURCES = 8;

/** GET ?ids=a,b → { research: { [id]: CoinResearch } }; with &events=1 also each coin's thesis history. */
export async function GET(req: NextRequest) {
  await connection();
  try {
    const ids = (req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 50);
    const research = await getResearch(ids);
    if (req.nextUrl.searchParams.get("events") !== "1") return Response.json({ research });
    const events: Record<string, ThesisEvent[]> = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await listThesisEvents(id)])));
    return Response.json({ research, events });
  } catch (err) {
    return errorResponse(err);
  }
}

const text = (v: unknown, max: number) => String(v ?? "").slice(0, max);

function cleanAssumption(a: Partial<Assumption>, i: number): Assumption {
  const c = a.check;
  const metric = c?.metric && c.metric in CHECK_METRICS ? (c.metric as CheckMetric) : null;
  const value = Number(c?.value);
  return {
    id: text(a.id, 40) || `a${Date.now().toString(36)}${i}`,
    text: text(a.text, 300),
    check:
      metric && c
        ? metric === "narrativeStage"
          ? { metric, op: "in", value: null, stages: (c.stages ?? []).filter((s) => STAGES.includes(s)) }
          : { metric, op: c.op === "<=" ? "<=" : ">=", value: Number.isFinite(value) ? value : null }
        : null,
  };
}

function cleanEvidence(e: Partial<CoinResearch["evidence"]> | undefined): CoinResearch["evidence"] {
  const out: CoinResearch["evidence"] = {};
  for (const key of NOTES) {
    const tag = e?.[key] as Partial<EvidenceTag> | undefined;
    if (!tag) continue;
    const status = tag.status === "verified" || tag.status === "inferred" || tag.status === "unknown" ? tag.status : null;
    // Only real web links are kept.
    const sources = (tag.sources ?? []).map((s) => text(s, 500).trim()).filter((s) => /^https?:\/\/\S+$/i.test(s)).slice(0, MAX_SOURCES);
    if (status || sources.length) out[key] = { status, sources };
  }
  return out;
}

/** PUT { id, research } → saves your ratings (1–10 or null), notes, thesis and evidence for a coin, and logs what changed. */
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; research?: Partial<CoinResearch> };
    if (!body.id) return Response.json({ error: "Missing coin id" }, { status: 400 });
    const r = body.research ?? {};
    const rating = (v: unknown) => {
      const n = Number(v);
      return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : Math.min(10, Math.max(1, Math.round(n)));
    };
    const stance = r.thesis?.stance;
    const reviewOn = text(r.thesis?.reviewOn, 10);
    const clean: CoinResearch = {
      ratings: Object.fromEntries(RATINGS.map((k) => [k, rating(r.ratings?.[k])])) as CoinResearch["ratings"],
      notes: Object.fromEntries(NOTES.map((k) => [k, text(r.notes?.[k], 4000)])) as CoinResearch["notes"],
      thesis: {
        stance: stance === "bullish" || stance === "neutral" || stance === "bearish" ? stance : null,
        summary: text(r.thesis?.summary, 600),
        assumptions: (r.thesis?.assumptions ?? []).slice(0, MAX_ASSUMPTIONS).map(cleanAssumption),
        reviewOn: /^\d{4}-\d{2}-\d{2}$/.test(reviewOn) ? reviewOn : null,
      },
      evidence: cleanEvidence(r.evidence),
      updatedAt: null,
    };
    const before = (await getResearch([body.id]))[body.id];
    const saved = await saveResearch(body.id, clean);
    try {
      await logThesisChanges(body.id, before, saved);
    } catch (err) {
      console.warn("[research] history:", err instanceof Error ? err.message : err);
    }
    return Response.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}
