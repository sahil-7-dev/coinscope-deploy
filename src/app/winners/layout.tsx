import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/winners",
  "Crypto Winners Since 2021",
  "Every +50% run since 2021 for top-performing coins, with their fundamentals before each run next to at the peak, and what the winners did and didn't share.",
);

export default function Layout({ children }: LayoutProps<"/winners">) {
  return children;
}
