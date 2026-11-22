"use client";

// Light/dark theme state (stored on <html data-theme> and in localStorage) plus
// concrete chart colors, since Recharts needs real values rather than CSS variables.
// Keep the palettes in sync with the tokens in globals.css.

import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";
const KEY = "coinscope.theme";
const listeners = new Set<() => void>();

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const read = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // storage unavailable; theme just won't persist
  }
  listeners.forEach((l) => l());
}

export const useTheme = () => useSyncExternalStore(subscribe, read, (): Theme => "light");

const PALETTES = {
  light: { up: "#00a83e", down: "#ea3943", brand: "#4bcc00", warn: "#d97706", info: "#2f6fed", grid: "#e5e9ef", axis: "#8a94a6", volume: "#dfe5ec", cursor: "#cbd5e1" },
  dark: { up: "#16c784", down: "#ea3943", brand: "#4bcc00", warn: "#f5a524", info: "#5b8def", grid: "#222d39", axis: "#6f7d90", volume: "#2a3644", cursor: "#344354" },
};

export const useChartColors = () => PALETTES[useTheme()];
