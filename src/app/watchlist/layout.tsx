import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/watchlist",
  "Watchlist",
  "Your tracked coins, verdict changes, thesis health and review dates.", { private: true },
);

export default function Layout({ children }: LayoutProps<"/watchlist">) {
  return children;
}
