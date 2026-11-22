"use client";

import { useMemo, useState } from "react";
import type { CoinProfile } from "@/lib/types";
import { buildChecklist } from "@/lib/analysis/checklist";
import { scoreCandidate } from "@/lib/analysis/score";
import { fetchProfiles, profileErrors as errorText } from "@/lib/api";
import { useCandidates, useSavedChecklist, useWinners } from "@/lib/useStored";
import { Button, Card, ErrorBox, SectionTitle, Spinner } from "@/components/ui";
import { CoinPicker } from "@/components/CoinPicker";
import { WinnerCard } from "@/components/analyze/WinnerCard";
import { ChecklistEditor } from "@/components/analyze/ChecklistEditor";
import { ScoreResults } from "@/components/analyze/ScoreResults";
import { BacktestPanel } from "@/components/analyze/BacktestPanel";

export default function AnalyzePage() {
  const [winners, setWinners] = useWinners();
  const [candidates, setCandidates] = useCandidates();
  const [checklist, setChecklist] = useSavedChecklist();

  const [winnerProfiles, setWinnerProfiles] = useState<CoinProfile[] | null>(null);
  const [candidateProfiles, setCandidateProfiles] = useState<CoinProfile[] | null>(null);
  const [busy, setBusy] = useState<"winners" | "candidates" | null>(null);
  const [winnerError, setWinnerError] = useState<string | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);

  const analyzeWinners = async () => {
    setBusy("winners");
    setWinnerError(null);
    try {
      const res = await fetchProfiles(winners);
      setWinnerProfiles(res.profiles);
      setWinnerError(errorText(res));
      if (res.profiles.length) setChecklist(buildChecklist(res.profiles));
    } catch (err) {
      setWinnerError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setBusy(null);
    }
  };

  const scoreCandidates = async () => {
    setBusy("candidates");
    setCandidateError(null);
    try {
      const res = await fetchProfiles(candidates);
      setCandidateProfiles(res.profiles);
      setCandidateError(errorText(res));
    } catch (err) {
      setCandidateError(err instanceof Error ? err.message : "Scoring failed");
    } finally {
      setBusy(null);
    }
  };

  // Re-scores instantly whenever the checklist is edited.
  const results = useMemo(
    () => (checklist && candidateProfiles ? candidateProfiles.map((c) => scoreCandidate(c, checklist)) : null),
    [checklist, candidateProfiles],
  );

  const loadingHint = "Fetching and analyzing. Requests are rate-limited to fit CoinGecko's free tier, so many coins can take up to a minute.";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">Analyze & Score</h1>
        <p className="mt-1 max-w-4xl text-base text-muted">
          1. Pick coins that performed well. 2. See what drove them and get a checklist. 3. Score other coins against it.
        </p>
      </div>

      {/* Step 1 */}
      <Card>
        <SectionTitle
          title="Step 1: Winners"
          subtitle="Coins that ran recently. 3–6 similar coins (same sector or the same kind of move) give the best checklist."
          right={
            <Button onClick={analyzeWinners} disabled={!winners.length || busy !== null}>
              {busy === "winners" ? "Analyzing…" : `Analyze ${winners.length || ""} winner${winners.length === 1 ? "" : "s"}`}
            </Button>
          }
        />
        <CoinPicker value={winners} onChange={setWinners} placeholder="Search a coin that performed well (e.g. Solana, Render, Pepe)…" />
        {busy === "winners" && (
          <div className="mt-3">
            <Spinner label={loadingHint} />
          </div>
        )}
        {winnerError && (
          <div className="mt-3">
            <ErrorBox message={winnerError} />
          </div>
        )}
      </Card>

      {winnerProfiles && winnerProfiles.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Winner breakdown</h2>
          {winnerProfiles.map((p) => (
            <WinnerCard key={p.id} p={p} />
          ))}
        </div>
      )}

      {/* Step 2 */}
      <Card>
        <SectionTitle
          title="Step 2: Winner checklist"
          subtitle={
            checklist ? (
              <>
                What {checklist.winners.map((w) => w.name).join(", ")} had in common <i>at their breakout</i>. Toggle items, edit targets and weights.
                Scores update live.
              </>
            ) : (
              "Analyze some winners to generate a checklist."
            )
          }
          right={
            checklist && (
              <div className="flex gap-2">
                {winnerProfiles?.length ? (
                  <Button variant="ghost" onClick={() => setChecklist(buildChecklist(winnerProfiles))}>
                    Reset to generated
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={() => setChecklist(null)}>
                  Clear
                </Button>
              </div>
            )
          }
        />
        {checklist && (
          <>
            {checklist.notes.map((n) => (
              <p key={n} className="mb-2 rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">
                {n}
              </p>
            ))}
            <ChecklistEditor checklist={checklist} onChange={setChecklist} />
          </>
        )}
      </Card>

      {checklist && checklist.items.length > 0 && (
        <Card>
          <SectionTitle
            title="Backtest the checklist"
            subtitle="Would this checklist have picked winners over the past year? Compare its picks with buying on a random day."
          />
          <BacktestPanel checklist={checklist} coins={[...winners, ...candidates.filter((c) => !winners.some((w) => w.id === c.id))]} />
        </Card>
      )}

      {/* Step 3 */}
      <Card>
        <SectionTitle
          title="Step 3: Score candidates"
          subtitle="Coins you're considering. Each is scored on its current data against the checklist."
          right={
            <Button onClick={scoreCandidates} disabled={!candidates.length || !checklist || busy !== null}>
              {busy === "candidates" ? "Scoring…" : `Score ${candidates.length || ""} candidate${candidates.length === 1 ? "" : "s"}`}
            </Button>
          }
        />
        <CoinPicker value={candidates} onChange={setCandidates} placeholder="Search a coin you're considering…" />
        {!checklist && <p className="mt-2 text-sm text-subtle">Build a checklist in Step 1 first.</p>}
        {busy === "candidates" && (
          <div className="mt-3">
            <Spinner label={loadingHint} />
          </div>
        )}
        {candidateError && (
          <div className="mt-3">
            <ErrorBox message={candidateError} />
          </div>
        )}
        {results && results.length > 0 && (
          <div className="mt-4">
            <ScoreResults results={results} />
            <p className="mt-3 text-sm text-subtle">
              Score = share of checklist weight passed, among criteria with data. A high score means the coin looks like the winners did before they
              ran. It doesn&apos;t mean it will run. Always review the red flags and check for catalysts.
            </p>
          </div>
        )}
      </Card>
    </div>
  );
}
