// Coin news: CryptoPanic when CRYPTOPANIC_API_KEY is set, otherwise headlines
// from major crypto outlets' public RSS feeds, filtered by coin name/symbol.

import type { NewsItem, NewsResponse } from "@/lib/types";
import { cached, MINUTE } from "@/lib/server/cache";

const CRYPTOPANIC_KEY = process.env.CRYPTOPANIC_API_KEY?.trim() || undefined;
const CRYPTOPANIC_BASE = process.env.CRYPTOPANIC_API_BASE?.trim() || "https://cryptopanic.com/api/developer/v2";

const FEEDS = [
  { source: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { source: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { source: "Decrypt", url: "https://decrypt.co/feed" },
  { source: "The Block", url: "https://www.theblock.co/rss.xml" },
];

interface RssItem extends NewsItem {
  text: string;
}

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "";

async function fetchFeed(feed: (typeof FEEDS)[number]): Promise<RssItem[]> {
  const res = await fetch(feed.url, {
    headers: { "user-agent": "Mozilla/5.0 (CoinScope news reader)" },
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!res.ok) return [];
  const xml = await res.text();
  return [...xml.matchAll(/<item[\s>]([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const pub = tag(item, "pubDate") || tag(item, "dc:date");
    return {
      title: decode(tag(item, "title")),
      url: decode(tag(item, "link")) || decode(tag(item, "guid")),
      source: feed.source,
      publishedAt: pub ? new Date(pub).toISOString() : new Date(0).toISOString(),
      text: decode(`${tag(item, "title")} ${tag(item, "description")} ${tag(item, "category")}`),
    };
  });
}

const allRss = () =>
  cached("news:rss", 15 * MINUTE, async () => {
    const lists = await Promise.allSettled(FEEDS.map(fetchFeed));
    return lists
      .flatMap((l) => (l.status === "fulfilled" ? l.value : []))
      .filter((i) => i.title && i.url)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  });

/** Words that are also tickers and would match unrelated headlines. */
const AMBIGUOUS = new Set(["ONE", "NEAR", "SUN", "GAS", "ALL", "FOR", "TRUMP", "BLUR", "MOVE", "S", "IO", "AI", "OM", "ME", "TON", "BAT"]);

function mentions(text: string, name: string, symbol: string): boolean {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${esc(name)}\\b`, "i").test(text)) return true;
  const sym = symbol.toUpperCase();
  return sym.length >= 3 && !AMBIGUOUS.has(sym) && new RegExp(`(\\$|\\b)${esc(sym)}\\b`).test(text);
}

async function fromCryptoPanic(symbol: string): Promise<NewsItem[]> {
  const url = `${CRYPTOPANIC_BASE}/posts/?auth_token=${CRYPTOPANIC_KEY}&currencies=${encodeURIComponent(symbol.toUpperCase())}&public=true`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
  if (!res.ok) throw new Error(`CryptoPanic returned ${res.status}`);
  const body = (await res.json()) as {
    results?: { title: string; url?: string; original_url?: string; id?: number; slug?: string; published_at: string; source?: { title?: string } }[];
  };
  return (body.results ?? []).map((r) => ({
    title: r.title,
    url: r.original_url ?? r.url ?? `https://cryptopanic.com/news/${r.id}/${r.slug}`,
    source: r.source?.title ?? "CryptoPanic",
    publishedAt: r.published_at,
  }));
}

export async function getNews(coin: { name: string; symbol: string } | null): Promise<NewsResponse> {
  if (coin && CRYPTOPANIC_KEY) {
    try {
      const items = await cached(`news:cp:${coin.symbol}`, 15 * MINUTE, () => fromCryptoPanic(coin.symbol));
      return { items: items.slice(0, 20), source: "CryptoPanic" };
    } catch (err) {
      console.warn("[news]", err instanceof Error ? err.message : err);
    }
  }

  const rss = await allRss();
  const items = (coin ? rss.filter((i) => mentions(i.text, coin.name, coin.symbol)) : rss)
    .slice(0, 20)
    .map((i) => ({ title: i.title, url: i.url, source: i.source, publishedAt: i.publishedAt }));
  return {
    items,
    source: "RSS",
    note: CRYPTOPANIC_KEY
      ? undefined
      : "Headlines from Cointelegraph, CoinDesk, Decrypt and The Block that mention this coin. Add CRYPTOPANIC_API_KEY to .env.local for coin-tagged news.",
  };
}
