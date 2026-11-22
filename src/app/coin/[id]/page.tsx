import { Suspense } from "react";
import { Spinner } from "@/components/ui";
import { CoinView } from "./CoinView";

// The coin id comes from the URL, so the view renders inside Suspense (required by Cache Components).
export default function CoinPage() {
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <CoinView />
    </Suspense>
  );
}
