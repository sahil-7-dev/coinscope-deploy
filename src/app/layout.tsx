import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { SITE_DESCRIPTION, SITE_KEYWORDS, SITE_NAME, SITE_TITLE, SITE_URL } from "@/lib/site";
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
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: SITE_KEYWORDS,
  category: "finance",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: SITE_NAME, title: SITE_TITLE, description: SITE_DESCRIPTION, url: "/", locale: "en_US" },
  twitter: { card: "summary_large_image", title: SITE_TITLE, description: SITE_DESCRIPTION },
  robots: { index: true, follow: true },
};

// Structured data so search engines can show CoinScope as a free finance web app.
const JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
});

// Applies the theme before first paint so there's no light→dark flash: ?theme=dark|light in the URL wins, then the saved choice.
const THEME_SCRIPT = `try{var q=new URLSearchParams(location.search).get("theme");var t=q==="dark"||q==="light"?q:localStorage.getItem("coinscope.theme");if(t==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
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
