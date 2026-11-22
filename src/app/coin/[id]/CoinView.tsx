"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { CoinProfile, CoinResearch, ThesisEvent } from "@/lib/types";
import { api, errMsg, fetchProfiles } from "@/lib/api";
import { Card, ErrorBox, SectionTitle, Spinner } from "@/components/ui";
import { PriceVolumeChart } from "@/components/PriceVolumeChart";
import { ScoresPanel } from "@/components/ScoresPanel";
import { DataPanels } from "@/components/DataPanels";
import { NewsPanel } from "@/components/NewsPanel";
import { CoinActions } from "@/components/CoinActions";
import { CoinHero, DriverList, RallySummary, RedFlagList } from "@/components/analyze/CoinDetails";
import { VerdictPanel } from "@/components/VerdictPanel";
import { BackersPanel, SupplyPanel } from "@/components/SupplyPanels";
import { CoinNarrativeChip } from "@/components/NarrativeBadge";
import { verdictFor } from "@/lib/analysis/verdict";
import { AboutPanel, CompetitorsTable, EMPTY_RESEARCH, ResearchPanel, Scorecard } from "@/components/FundamentalReport";

export function CoinView() {
  const { id } = useParams<{ id: string }>();
  const [profile, setProfile] = useState<CoinProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [research, setResearch] = useState<CoinResearch>(EMPTY_RESEARCH);
  const [events, setEvents] = useState<ThesisEvent[]>([]);
  const [eventsKey, setEventsKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchProfiles([decodeURIComponent(id)])
      .then((res) => {
        if (cancelled) return;
        if (res.profiles[0]) setProfile(res.profiles[0]);
        else setError(res.errors[0]?.message ?? "Coin not found");
      })
      .catch((err) => !cancelled && setError(errMsg(err, "Failed to load coin")));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Research and its history. History reloads after each save, and once the profile arrives (building it runs the thesis checks).
  useEffect(() => {
    let cancelled = false;
    const coin = decodeURIComponent(id);
    api<{ research: Record<string, CoinResearch>; events: Record<string, ThesisEvent[]> }>(`/api/research?ids=${encodeURIComponent(coin)}&events=1`)
      .then((r) => {
        if (cancelled) return;
        setResearch(r.research[coin] ?? EMPTY_RESEARCH);
        setEvents(r.events[coin] ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, eventsKey, profile]);

  if (error) return <ErrorBox message={error} />;
  if (!profile) return <Spinner label="Analyzing coin: price history, fundamentals, exchanges, derivatives…" />;
  const p = profile;
  const verdict = verdictFor(p, { research });

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <CoinHero p={p} />
        <CoinActions p={p} showOpen={false} />
      </Card>

      <Card>
        <SectionTitle
          title="Verdict"
          subtitle="Fundamentals first, no technical analysis. Compare it with coins that already ran on the Coin Check page."
          right={<CoinNarrativeChip narrative={p.narrative} loaded={p.narrativeLoaded} />}
        />
        <VerdictPanel verdict={verdict} />
      </Card>

      <Card>
        <SectionTitle title="What it is" subtitle="The project in its own words, plus what DefiLlama knows about it." />
        <AboutPanel about={p.about} f={p.fundamentals} categories={p.categories} dev={p.devActivity} gov={p.governance} />
      </Card>

      <Card>
        <SectionTitle title="Fundamental scorecard" subtitle="Eight categories, weighted. Click one to see every metric behind it. Your ratings below fill in what data can't measure." />
        <Scorecard fa={verdict.fundamentals} />
      </Card>

      <Card>
        <SectionTitle title="Competitors" subtitle="How it stacks up against the biggest fee earners doing the same thing. Fill in “Versus competitors” below with your view." />
        <CompetitorsTable f={p.fundamentals} />
      </Card>

      <Card>
        <SectionTitle title="Supply: unlocks and holders" subtitle="New supply landing during your hold, and how concentrated the holders are. Big unlocks lower the tokenomics score; both can raise red flags." />
        <SupplyPanel p={p} />
      </Card>

      <Card>
        <SectionTitle title="Backers and community" subtitle="Who funded it and whether its community is growing. Context for your research; not scored." />
        <BackersPanel p={p} />
      </Card>

      <Card>
        <SectionTitle
          title="Your research"
          subtitle="Your thesis and the judgment calls data can't make. Assumptions with a data check are re-checked every time the coin is analyzed. Tag each answer's evidence. Saved on this computer; use case, moat and team ratings count in the score."
        />
        <ResearchPanel
          key={research.updatedAt ?? "new"}
          profile={p}
          research={research}
          events={events}
          onSaved={(r) => {
            setResearch(r);
            setEventsKey((k) => k + 1);
          }}
        />
      </Card>

      <Card>
        <SectionTitle title="Other scores" subtitle="Short-term is technical and only here for reference. Risk uses price volatility as context. Click a score for its factors." />
        <ScoresPanel scores={p.scores} />
      </Card>

      <Card className="space-y-3">
        <SectionTitle title="Price & volume (1 year)" />
        <RallySummary p={p} />
        <PriceVolumeChart series={p.series} rally={p.rally} height={260} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle title="What's driving it" />
          <DriverList drivers={p.drivers} />
        </Card>
        <Card>
          <SectionTitle title="Red flags" />
          <RedFlagList flags={p.redFlags} />
        </Card>
      </div>

      <Card>
        <SectionTitle title="All metrics" />
        <DataPanels p={p} />
      </Card>

      <Card>
        <SectionTitle
          title="News"
          subtitle={p.rally ? "Headlines dated during the latest run are highlighted, since they're likely catalysts." : undefined}
        />
        <NewsPanel name={p.name} symbol={p.symbol} highlight={p.rally ? { from: p.rally.lowDate, to: p.rally.peakDate } : undefined} />
      </Card>
    </div>
  );
}
