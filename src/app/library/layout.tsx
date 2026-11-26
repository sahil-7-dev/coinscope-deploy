import { pageMetadata } from "@/lib/site";

export const metadata = pageMetadata(
  "/library",
  "Benchmark Library",
  "Your saved benchmark coins with metrics and notes.", { private: true },
);

export default function Layout({ children }: LayoutProps<"/library">) {
  return children;
}
