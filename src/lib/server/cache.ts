// In-memory TTL cache with in-flight de-duplication (plus a disk-backed variant).
// Lives on globalThis so it survives hot reloads in dev. Used instead of Next's
// fetch cache because some upstream payloads (DefiLlama /protocols) exceed its 2MB item limit.

import { readHttpCache, writeHttpCache } from "./db";

type Entry = { value: unknown; expires: number };

const g = globalThis as unknown as {
  __cacheStore?: Map<string, Entry>;
  __cacheInflight?: Map<string, Promise<unknown>>;
};
const store = (g.__cacheStore ??= new Map());
const inflight = (g.__cacheInflight ??= new Map());

export const MINUTE = 60_000;

/** Returns a fresh cached value without loading it. */
export function peek<T>(key: string): T | undefined {
  const hit = store.get(key);
  return hit && hit.expires > Date.now() ? (hit.value as T) : undefined;
}

export function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  return cachedUntil(key, async () => ({ value: await load(), expires: Date.now() + ttlMs }));
}

/** Like `cached`, but the loader decides when its value expires (e.g. a value restored from disk keeps its original age). */
export async function cachedUntil<T>(key: string, load: () => Promise<{ value: T; expires: number }>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = load()
    .then(({ value, expires }) => {
      store.set(key, { value, expires });
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/**
 * Like `cached`, but values also live on disk (SQLite), so a restart doesn't
 * re-download them. `null` results aren't saved to disk (they may be temporary)
 * and are retried after `nullTtlMs`.
 */
export function cachedPersistent<T>(key: string, ttlMs: number, load: () => Promise<T | null>, nullTtlMs = 60 * MINUTE): Promise<T | null> {
  return cachedUntil(key, async () => {
    try {
      const saved = await readHttpCache<T>(key, ttlMs);
      if (saved) return { value: saved.value as T | null, expires: saved.savedAt + ttlMs };
    } catch {
      // Disk cache unavailable: fall through to loading.
    }
    const value = await load();
    if (value === null) return { value, expires: Date.now() + nullTtlMs };
    try {
      await writeHttpCache(key, value);
    } catch (err) {
      console.warn("[cache] disk write:", err instanceof Error ? err.message : err);
    }
    return { value, expires: Date.now() + ttlMs };
  });
}
