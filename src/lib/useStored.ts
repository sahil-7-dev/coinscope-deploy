"use client";

// localStorage-backed state shared across components and tabs. Falls back to
// the default when storage is unavailable (private mode, blocked site data).

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Checklist, PickedCoin } from "@/lib/types";

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** `fallback` must be a stable reference (a module-level constant). */
export function useStored<T>(key: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null,
  );
  const value = useMemo(() => parse(raw, fallback), [raw, fallback]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const prev = parse(readRaw(key), fallback);
      const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      try {
        if (v === null) localStorage.removeItem(key);
        else localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // storage unavailable; state just won't persist
      }
      listeners.forEach((l) => l());
    },
    [key, fallback],
  );

  return [value, set];
}

const NO_COINS: PickedCoin[] = [];

export const useWinners = () => useStored<PickedCoin[]>("coinscope.winners", NO_COINS);
export const useCandidates = () => useStored<PickedCoin[]>("coinscope.candidates", NO_COINS);
export const useSavedChecklist = () => useStored<Checklist | null>("coinscope.checklist", null);

export function addCoin(list: PickedCoin[], coin: PickedCoin, max = 12): PickedCoin[] {
  if (list.some((c) => c.id === coin.id) || list.length >= max) return list;
  return [...list, coin];
}
