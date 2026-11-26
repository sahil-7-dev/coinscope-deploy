import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { NarrativeView } from "./NarrativeView";
import { pageMetadata, titleFromSlug } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/narratives/[id]">): Promise<Metadata> {
  const { id } = await params;
  const name = titleFromSlug(id);
  const description = `${name} crypto narrative: its stage from fundamentals, fee growth vs the market, top coins ranked by fundamentals, stage history since 2021 and news.`;
  return pageMetadata(`/narratives/${id}`, `${name} Narrative: Stage, Fees & Top Coins`, description);
}

// The narrative id comes from the URL, so the view renders inside Suspense (required by Cache Components).
export default function NarrativePage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <NarrativeView />
    </Suspense>
  );
}
