import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // /api/ is blocked so crawlers don't spend the monthly CoinGecko budget.
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", ...PRIVATE_PATHS] },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
