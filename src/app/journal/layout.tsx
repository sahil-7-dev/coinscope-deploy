import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/journal",
  "Decision Journal",
  "Your logged buys and passes, judged against BTC after 30 days.", { private: true },
);

export default function Layout({ children }: LayoutProps<"/journal">) {
  return children;
}
