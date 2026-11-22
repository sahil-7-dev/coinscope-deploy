// GitHub: developer activity on a project's main repo (commits over the last
// 24 weeks, contributors). Free: 60 requests/hour without a token, 5,000 with a
// GITHUB_TOKEN from any free account (no scopes needed). Cached for a day.

import { cachedPersistent, MINUTE } from "@/lib/server/cache";
import type { DevActivity } from "@/lib/types";

const TOKEN = process.env.GITHUB_TOKEN?.trim() || undefined;
const g = globalThis as unknown as { __ghBlockedUntil?: number };

/** A GitHub API call, or null when rate-limited, missing, or still being computed (202). */
async function gh(path: string): Promise<{ body: unknown; link: string | null } | null> {
  if ((g.__ghBlockedUntil ?? 0) > Date.now()) return null;
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "coinscope", ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  }).catch(() => null);
  if (!res) return null;
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    // Out of free requests: stop asking until the hourly window resets.
    g.__ghBlockedUntil = Number(res.headers.get("x-ratelimit-reset")) * 1000 || Date.now() + 60 * MINUTE;
    return null;
  }
  if (res.status !== 200) return null;
  return { body: await res.json().catch(() => null), link: res.headers.get("link") };
}

/** "https://github.com/owner/repo/..." → "owner/repo"; an org URL gives just "owner". */
function parseRepo(url: string): { owner: string; repo: string | null } | null {
  const m = url.match(/github\.com\/([^/?#]+)(?:\/([^/?#]+))?/i);
  return m ? { owner: m[1], repo: m[2]?.replace(/\.git$/, "") ?? null } : null;
}

/** An org's most recently pushed non-fork repo. */
async function mainRepo(org: string): Promise<string | null> {
  const res = await gh(`/orgs/${encodeURIComponent(org)}/repos?sort=pushed&per_page=10`);
  const repos = Array.isArray(res?.body) ? (res.body as { full_name: string; fork: boolean; archived: boolean }[]) : [];
  return repos.find((r) => !r.fork && !r.archived)?.full_name ?? null;
}

async function repoActivity(fullName: string): Promise<DevActivity | null> {
  const [weeks, contrib] = await Promise.all([gh(`/repos/${fullName}/stats/commit_activity`), gh(`/repos/${fullName}/contributors?per_page=1&anon=true`)]);
  const totals = Array.isArray(weeks?.body) ? (weeks.body as { total: number }[]).map((w) => w.total) : null;
  if (!totals || totals.length < 24) return null;
  const last12 = totals.slice(-12);
  // The Link header's last page number is the contributor count when there's one per page.
  const lastPage = contrib?.link?.match(/[?&]page=(\d+)>;\s*rel="last"/)?.[1];
  return {
    repo: fullName,
    commits12w: last12.reduce((a, b) => a + b, 0),
    commitsPrev12w: totals.slice(-24, -12).reduce((a, b) => a + b, 0),
    activeWeeks12: last12.filter((t) => t > 0).length,
    contributors: lastPage ? Number(lastPage) : Array.isArray(contrib?.body) ? (contrib.body as unknown[]).length : null,
  };
}

/**
 * Activity for a project's busiest repo: the one CoinGecko lists, or its org's
 * most recently pushed repo (listed repos are often an old version), with the
 * orgs DefiLlama lists as a fallback.
 */
export function devActivity(repoUrl: string | null, orgs: string[]): Promise<DevActivity | null> {
  const parsed = repoUrl ? parseRepo(repoUrl) : null;
  const key = `gh2:${parsed ? `${parsed.owner}/${parsed.repo ?? ""}` : `orgs:${orgs.join(",")}`}`;
  return cachedPersistent(key, 24 * 60 * MINUTE, async () => {
    const owner = parsed?.owner ?? orgs[0];
    if (!owner) return null;
    const listed = parsed?.repo ? `${parsed.owner}/${parsed.repo}` : null;
    const active = await mainRepo(owner);
    const names = [...new Set([listed, active].filter((x): x is string => !!x))];
    const results = (await Promise.all(names.map(repoActivity))).filter((r): r is DevActivity => r !== null);
    return results.sort((a, b) => b.commits12w - a.commits12w)[0] ?? null;
  });
}
