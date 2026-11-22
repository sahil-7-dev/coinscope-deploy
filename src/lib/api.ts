"use client";

// Small fetch helpers for the dashboard: JSON in, JSON out, API errors thrown as Error(message).

import type { CoinProfile, PickedCoin, ProfilesResponse } from "@/lib/types";

export async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? "POST" : "GET"),
    headers: init?.body ? { "content-type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const CHUNK = 20;

/** Fetches full profiles in chunks of 20 (the API limit). */
export async function fetchProfiles(coins: (PickedCoin | string)[]): Promise<ProfilesResponse> {
  const ids = coins.map((c) => (typeof c === "string" ? c : c.id));
  const out: ProfilesResponse = { profiles: [], errors: [] };
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await api<ProfilesResponse>(`/api/profiles?ids=${ids.slice(i, i + CHUNK).map(encodeURIComponent).join(",")}`);
    out.profiles.push(...res.profiles);
    out.errors.push(...res.errors);
  }
  return out;
}

export function profileErrors(res: ProfilesResponse): string | null {
  return res.errors.length ? `Couldn't load: ${res.errors.map((e) => `${e.id} (${e.message})`).join("; ")}` : null;
}

export const toPicked = (p: CoinProfile): PickedCoin => ({ id: p.id, name: p.name, symbol: p.symbol, thumb: p.image ?? undefined });

export const errMsg = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
