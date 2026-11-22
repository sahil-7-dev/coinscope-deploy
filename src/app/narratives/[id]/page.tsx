import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { NarrativeView } from "./NarrativeView";

// The narrative id comes from the URL, so the view renders inside Suspense (required by Cache Components).
export default function NarrativePage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <NarrativeView />
    </Suspense>
  );
}
