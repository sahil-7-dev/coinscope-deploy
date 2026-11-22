import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CoinScope: Crypto Opportunity Analyzer",
  description: "Market trends, winner breakdowns, similarity matching and investment scores for crypto.",
};

// Applies the theme before first paint so there's no light→dark flash: ?theme=dark|light in the URL wins, then the saved choice.
const THEME_SCRIPT = `try{var q=new URLSearchParams(location.search).get("theme");var t=q==="dark"||q==="light"?q:localStorage.getItem("coinscope.theme");if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body suppressHydrationWarning className="flex min-h-full flex-col">
        <Nav />
        <main className="mx-auto w-full max-w-[1680px] flex-1 px-4 py-7 sm:px-6 lg:px-10">{children}</main>
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-subtle sm:px-6 lg:px-10">
            <span className="font-semibold text-muted">CoinScope</span>
            <span>Data: CoinGecko · DefiLlama · Binance/Bybit · alternative.me. Pattern analysis, not financial advice.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
