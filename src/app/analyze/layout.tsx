import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/analyze",
  "Analyze & Score Coins",
  "Break down what drove past crypto winners, build a fundamentals checklist, backtest it and score new candidates.",
);

export default function Layout({ children }: LayoutProps<"/analyze">) {
  return children;
}
