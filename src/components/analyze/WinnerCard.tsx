"use client";

import type { CoinProfile } from "@/lib/types";
import { Card } from "@/components/ui";
import { PriceVolumeChart } from "@/components/PriceVolumeChart";
import { CoinActions } from "@/components/CoinActions";
import { MiniScores } from "@/components/ScoresPanel";
import { CoinHeader, DriverList, MetricsGrid, RallySummary, RedFlagList } from "./CoinDetails";

export function WinnerCard({ p }: { p: CoinProfile }) {
  return (
    <Card className="space-y-4">
      <CoinHeader p={p} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MiniScores scores={p.scores} />
        <CoinActions p={p} />
      </div>
      <RallySummary p={p} />
      <PriceVolumeChart series={p.series} rally={p.rally} />
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-base font-bold text-fg">What drove the move</h3>
          <DriverList drivers={p.drivers} />
        </div>
        <div className="space-y-4">
          <MetricsGrid p={p} showSetup={!!p.rally} />
          <div>
            <h3 className="mb-2 text-base font-bold text-fg">Red flags now</h3>
            <RedFlagList flags={p.redFlags} />
          </div>
        </div>
      </div>
    </Card>
  );
}
