import type { Metadata } from "next";

// Site identity for metadata, the sitemap, robots.txt and the social image.
// Set NEXT_PUBLIC_SITE_URL to the public domain; on Vercel the production URL is used when it's unset.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
).replace(/\/$/, "");

export const SITE_NAME = "CoinScope";
export const SITE_TITLE = "CoinScope: Fundamentals-First Crypto Research & Narrative Discovery";
export const SITE_DESCRIPTION =
  "Free crypto fundamental analysis tool. Spot narratives whose fees and builders grow before the crowd notices, compare coins against past winners, and get a plain verdict for each coin. No technical analysis, no AI, free data only.";

export const SITE_KEYWORDS = [
  "crypto fundamental analysis",
  "crypto research tool",
  "crypto narratives",
  "narrative discovery",
  "altcoin screener",
  "token fundamentals",
  "protocol fees and revenue",
  "DefiLlama",
  "CoinGecko",
  "crypto backtest",
  "coin comparison",
  "crypto watchlist",
  "token unlocks",
];

// Pages that hold the user's own saved data: kept out of search results and the sitemap.
export const PRIVATE_PATHS = ["/watchlist", "/library", "/journal"];

// "decentralized-finance-defi" → "Decentralized Finance Defi"
export const titleFromSlug = (slug: string) =>
  decodeURIComponent(slug)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

// A page's title, description, canonical URL and share tags. A nested openGraph/twitter object replaces the
// root one rather than merging, so each page restates the site name and the share image here.
export function pageMetadata(path: string, title: string, description: string, opts: { private?: boolean } = {}): Metadata {
  const shareTitle = `${title} | ${SITE_NAME}`;
  const image = { url: "/opengraph-image", width: 1200, height: 630, alt: SITE_TITLE };
  return {
    title: { absolute: shareTitle }, // set in full: a nested layout's plain title stops the root template reaching pages below it
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: path, title: shareTitle, description, images: [image] },
    twitter: { card: "summary_large_image", title: shareTitle, description, images: [image.url] },
    ...(opts.private && { robots: { index: false, follow: false } }),
  };
}
