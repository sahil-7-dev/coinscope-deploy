"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import type { GlobalStats, SearchResult } from "@/lib/types";
import { fmtPct, fmtUsd, MIN_SEARCH, SEARCH_DELAY_MS } from "@/lib/format";
import { setTheme, useTheme } from "@/lib/theme";
import { CoinIcon, Pct } from "./ui";

const LINKS = [
  { href: "/", label: "Market" },
  { href: "/narratives", label: "Narratives" },
  { href: "/winners", label: "Winners" },
  { href: "/similarity", label: "Coin Check" },
  { href: "/analyze", label: "Analyze & Score" },
  { href: "/library", label: "Library" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/journal", label: "Journal" },
  { href: "/backtest", label: "Backtest" },
] as const;

// ---- Theme (light by default, like CoinGecko; the choice is remembered) ----

function ThemeToggle() {
  const theme = useTheme();
  return (
    <button
      type="button"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:bg-surface-3 hover:text-fg"
    >
      {theme === "dark" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

// ---- Global stats strip ----

function GlobalStrip() {
  const [g, setG] = useState<GlobalStats | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/global")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && d && setG(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const item = (label: string, value: React.ReactNode) => (
    <span className="shrink-0">
      <span className="text-muted">{label}: </span>
      <span className="font-semibold text-fg">{value}</span>
    </span>
  );

  return (
    <div className="border-b border-line bg-surface">
      <div className="mx-auto flex h-9 max-w-[1680px] items-center gap-5 overflow-x-auto px-4 text-xs sm:px-6 lg:px-10">
        {g ? (
          <>
            {item("Coins", g.activeCoins?.toLocaleString("en-US") ?? "—")}
            {item(
              "Market Cap",
              <>
                {fmtUsd(g.totalMarketCap)} <Pct value={g.change24h} />
              </>,
            )}
            {item("24h Vol", fmtUsd(g.totalVolume))}
            {item("Dominance", `BTC ${fmtPct(g.btcDominance, { signed: false })} · ETH ${fmtPct(g.ethDominance, { signed: false })}`)}
            {g.fearGreed && item("Fear & Greed", `${g.fearGreed.value} (${g.fearGreed.label})`)}
            <ApiUsage usage={g.apiUsage} />
          </>
        ) : (
          <span className="text-subtle">Loading market stats…</span>
        )}
      </div>
    </div>
  );
}

/** CoinGecko's free plan has a monthly call budget; warn well before it runs out. */
function ApiUsage({ usage }: { usage: GlobalStats["apiUsage"] | undefined }) {
  if (!usage) return null;
  const share = usage.calls / usage.limit;
  const tone = share >= 0.95 ? "text-down" : share >= 0.8 ? "text-warn" : "text-fg";
  return (
    <span
      className="ml-auto shrink-0"
      title={`CoinGecko calls made by this app in ${usage.month} (UTC). The free plan allows ${usage.limit.toLocaleString("en-US")} a month; past that, coin data stops loading until next month.${share >= 0.8 ? " Running low: open fewer new coins until the month resets." : ""}`}
    >
      <span className="text-muted">API calls: </span>
      <span className={`font-semibold ${tone}`}>
        {usage.calls.toLocaleString("en-US")} / {usage.limit.toLocaleString("en-US")}
      </span>
      {share >= 0.8 && <span className={`ml-1 ${tone}`}>{share >= 0.95 ? "almost out" : "running low"}</span>}
    </span>
  );
}

// ---- Search ----

function HeaderSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const query = q.trim();

  useEffect(() => {
    if (query.length < MIN_SEARCH) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((b) => {
          setResults(b.results ?? []);
          setActive(0);
        })
        .catch(() => {});
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  const shown = query.length >= MIN_SEARCH ? results : [];
  const go = (r: SearchResult) => {
    setQ("");
    setOpen(false);
    inputRef.current?.blur();
    router.push(`/coin/${r.id}`);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-xs">
      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-subtle" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, shown.length - 1));
          if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          if (e.key === "Enter" && shown[active]) go(shown[active]);
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder="Search coin"
        className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-8 text-sm outline-none transition placeholder:text-subtle focus:border-brand focus:bg-surface"
      />
      <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-line px-1.5 text-xs text-subtle">/</kbd>
      {open && shown.length > 0 && (
        <ul className="absolute right-0 z-40 mt-1.5 max-h-80 w-full min-w-64 overflow-auto rounded-xl border border-line bg-surface py-1 shadow-xl">
          {shown.map((r, i) => (
            <li key={r.id}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(r)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${i === active ? "bg-surface-3" : ""}`}
              >
                <CoinIcon src={r.thumb} alt={r.name} />
                <span className="font-medium text-fg">{r.name}</span>
                <span className="text-subtle">{r.symbol}</span>
                <span className="ml-auto text-xs text-subtle">{r.rank ? `#${r.rank}` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---- Header ----

function Logo() {
  return (
    <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-extrabold tracking-tight text-fg">
      <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="15" fill="var(--brand)" />
        <circle cx="20" cy="12.5" r="5.5" fill="#fff" />
        <circle cx="21" cy="12.5" r="2.6" fill="#0d1421" />
        <path d="M6 21c4 3.5 12 4 17 0" stroke="#0d1421" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.35" />
      </svg>
      CoinScope
    </Link>
  );
}

function NavBar({ active }: { active: string | null }) {
  const isActive = (href: string) => (href === "/" ? active === "/" : !!active?.startsWith(href));
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1680px] items-center gap-6 px-4 sm:px-6 lg:px-10">
        <Logo />
        <nav className="flex flex-1 gap-1 overflow-x-auto text-sm">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`relative shrink-0 px-3 py-4 font-semibold transition ${isActive(l.href) ? "text-fg" : "text-muted hover:text-fg"}`}
            >
              {l.label}
              {isActive(l.href) && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand" />}
            </Link>
          ))}
        </nav>
        <div className="hidden items-center gap-2 md:flex md:w-72">
          <HeaderSearch />
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}

function ActiveNav() {
  return <NavBar active={usePathname()} />;
}

/** The active-link highlight reads the URL, which dynamic routes only know at request time, hence Suspense. */
export function Nav() {
  return (
    <>
      <GlobalStrip />
      <Suspense fallback={<NavBar active={null} />}>
        <ActiveNav />
      </Suspense>
    </>
  );
}
