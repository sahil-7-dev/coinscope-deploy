import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/similarity",
  "Coin Check: Crypto Verdicts",
  "Paste the coins you're researching and get a fundamental score, narrative stage, winner-pattern fit and a plain verdict: Strong candidate, Watchlist, Speculative or Avoid.",
);

export default function Layout({ children }: LayoutProps<"/similarity">) {
  return children;
}
