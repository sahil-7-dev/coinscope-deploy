import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/narratives",
  "Crypto Narratives Tracker",
  "Which crypto sectors' fundamentals are improving before the market notices: narrative stages from fees vs the market, builders arriving, and attention shown separately.",
);

export default function Layout({ children }: LayoutProps<"/narratives">) {
  return children;
}
