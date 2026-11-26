import type { Metadata } from "next";
import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { CoinView } from "./CoinView";
import { pageMetadata, titleFromSlug } from "@/lib/site";

export async function generateMetadata({ params }: PageProps<"/coin/[id]">): Promise<Metadata> {
  const { id } = await params;
  const name = titleFromSlug(id);
  const description = `${name} fundamental analysis: verdict, 8-category scorecard, fees and revenue, competitors, token unlocks, holders and your own research notes. No technical analysis.`;
  return pageMetadata(`/coin/${id}`, `${name} Fundamentals & Research Report`, description);
}

// The coin id comes from the URL, so the view renders inside Suspense (required by Cache Components).
export default function CoinPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <CoinView />
    </Suspense>
  );
}
