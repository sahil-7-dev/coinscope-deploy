// Thesis history: what you changed in your thesis, and when its data checks
// started or stopped holding. Changes are logged on save; checks are re-run
// whenever a coin is analyzed, and only a change of result is logged.

import { assumptionLabel, thesisStatus } from "@/lib/analysis/thesis";
import type { CoinProfile, CoinResearch } from "@/lib/types";
import { getResearch, lastAssumptionStatus, recordThesisEvent } from "./db";

/** Logs the differences between two saves of a coin's research. */
export async function logThesisChanges(coinId: string, before: CoinResearch | undefined, after: CoinResearch): Promise<void> {
  const a = before?.thesis;
  const b = after.thesis;
  if ((a?.stance ?? null) !== b.stance) await recordThesisEvent(coinId, "stance", `Stance: ${a?.stance ?? "none"} → ${b.stance ?? "none"}.`);
  if ((a?.summary ?? "").trim() !== b.summary.trim() && b.summary.trim()) await recordThesisEvent(coinId, "summary", `Thesis: “${b.summary.trim()}”`);
  const oldIds = new Map((a?.assumptions ?? []).map((x) => [x.id, x]));
  const newIds = new Map(b.assumptions.map((x) => [x.id, x]));
  for (const [id, x] of newIds) if (!oldIds.has(id)) await recordThesisEvent(coinId, "assumption-added", `Added assumption: ${assumptionLabel(x)}.`);
  for (const [id, x] of oldIds) if (!newIds.has(id)) await recordThesisEvent(coinId, "assumption-removed", `Removed assumption: ${assumptionLabel(x)}.`);
  if ((a?.reviewOn ?? null) !== b.reviewOn && b.reviewOn) await recordThesisEvent(coinId, "review", `Next review set for ${b.reviewOn}.`);
  const notesChanged = JSON.stringify(before?.notes ?? {}) !== JSON.stringify(after.notes) || JSON.stringify(before?.evidence ?? {}) !== JSON.stringify(after.evidence);
  if (notesChanged) await recordThesisEvent(coinId, "notes", "Research notes or evidence updated.");
}

/** Re-runs a coin's assumption checks on a fresh profile and logs any that changed result. */
export async function trackThesis(p: CoinProfile): Promise<void> {
  const research = (await getResearch([p.id]))[p.id];
  if (!research?.thesis?.assumptions.length) return;
  for (const r of thesisStatus(research, p).results) {
    if (r.status !== "holds" && r.status !== "broken") continue;
    if ((await lastAssumptionStatus(p.id, r.assumption.id)) === r.status) continue;
    const what = `${assumptionLabel(r.assumption)}${r.rule ? ` (${r.rule})` : ""}: now ${r.current}`;
    await recordThesisEvent(p.id, r.status === "broken" ? "assumption-broken" : "assumption-holds", r.status === "broken" ? `Assumption broke: ${what}.` : `Assumption holds: ${what}.`, r.assumption.id);
  }
}
