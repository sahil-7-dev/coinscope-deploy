"use client";

import { useEffect, useRef, useState } from "react";
import type { PickedCoin, SearchResult } from "@/lib/types";
import { CoinIcon } from "./ui";
import { MIN_SEARCH, SEARCH_DELAY_MS } from "@/lib/format";

export function CoinPicker({
  value,
  onChange,
  placeholder,
  max = 12,
}: {
  value: PickedCoin[];
  onChange: (next: PickedCoin[]) => void;
  placeholder: string;
  max?: number;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const q = query.trim();

  useEffect(() => {
    if (q.length < MIN_SEARCH) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Search failed");
        setResults(body.results);
        setError(null);
      } catch (err) {
        if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : "Search failed");
      }
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const add = (coin: SearchResult) => {
    if (!value.some((c) => c.id === coin.id) && value.length < max) {
      onChange([...value, { id: coin.id, name: coin.name, symbol: coin.symbol, thumb: coin.thumb }]);
    }
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  const shown = q.length >= MIN_SEARCH ? results : [];

  return (
    <div ref={boxRef} className="space-y-2">
      <div className="relative">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) add(shown[0]);
            if (e.key === "Escape") setOpen(false);
          }}
          disabled={value.length >= max}
          placeholder={value.length >= max ? (max === 1 ? "Remove the coin to pick another" : `Maximum ${max} coins`) : placeholder}
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-subtle focus:border-brand"
        />
        {open && (shown.length > 0 || error) && (
          <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-xl">
            {error && <li className="px-3 py-2 text-sm text-down">{error}</li>}
            {shown.map((r) => {
              const picked = value.some((c) => c.id === r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={picked}
                    onClick={() => add(r)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-3 disabled:opacity-40"
                  >
                    <CoinIcon src={r.thumb} alt={r.name} />
                    <span className="text-fg">{r.name}</span>
                    <span className="text-subtle">{r.symbol}</span>
                    <span className="ml-auto text-xs text-subtle">{r.rank ? `#${r.rank}` : "unranked"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-3 py-1 pl-1.5 pr-2 text-sm">
              <CoinIcon src={c.thumb} alt={c.name} size={18} />
              {c.name}
              <span className="text-subtle">{c.symbol}</span>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => onChange(value.filter((x) => x.id !== c.id))}
                className="ml-0.5 text-subtle hover:text-down"
              >
                ✕
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange([])} className="text-xs text-subtle hover:text-fg-2">
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
