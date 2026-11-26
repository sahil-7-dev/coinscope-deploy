import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/backtest",
  "Crypto Fundamentals Backtest",
  "How well a fundamentals-only crypto score predicted returns since 2021 on ~440 coins, including delisted ones, after trading costs.",
);

export default function Layout({ children }: LayoutProps<"/backtest">) {
  return children;
}
