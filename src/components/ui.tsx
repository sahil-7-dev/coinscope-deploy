import type { ReactNode } from "react";
import type { Tone } from "@/lib/types";
import { pctTone } from "@/lib/format";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  // Default padding only when the caller didn't set its own (p-0, p-4…), since both classes would clash.
  const padding = /(^|\s)p-\S+/.test(className) ? "" : "p-5";
  return <section className={`rounded-2xl border border-line bg-surface shadow-card ${padding} ${className}`}>{children}</section>;
}

export function SectionTitle({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight text-fg">{title}</h2>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function PageHeader({ title, subtitle, right }: { title: string; subtitle?: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-4xl text-base text-muted">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

const TONES: Record<Tone, string> = {
  good: "bg-up/10 text-up",
  neutral: "bg-surface-3 text-fg-2",
  warn: "bg-warn/10 text-warn",
  bad: "bg-down/10 text-down",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${TONES[tone]}`}>{children}</span>;
}

/** CoinGecko-style percentage: ▲/▼ caret with the absolute value, green or red. */
export function Pct({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return <span className={`tabular text-subtle ${className}`}>—</span>;
  const abs = Math.abs(value * 100);
  const shown = abs.toFixed(abs >= 10 ? 0 : 1);
  // Rounds to zero: no arrow or color, so −0.04% doesn't read as a loss.
  if (Number(shown) === 0) return <span className={`tabular font-medium text-muted ${className}`}>0.0%</span>;
  return (
    <span className={`tabular inline-flex items-center gap-0.5 font-medium ${pctTone(value)} ${className}`}>
      <span className="text-[0.7em]">{value > 0 ? "▲" : "▼"}</span>
      {shown}%
    </span>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="tabular mt-1 text-xl font-bold text-fg">{value}</div>
      {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
    </Card>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-brand" />
      {label}
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return <div className="rounded-xl border border-down/30 bg-down/10 px-3 py-2 text-sm text-down">{message}</div>;
}

export function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  size = "md",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost";
  size?: "sm" | "md";
}) {
  const base = "inline-flex items-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-40";
  const sizes = size === "sm" ? "px-2.5 py-1 text-xs" : "px-4 py-2 text-sm";
  const variants =
    variant === "primary"
      ? "bg-brand text-black hover:bg-brand-strong hover:text-white"
      : "border border-line bg-surface text-fg-2 hover:bg-surface-3 hover:text-fg";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${sizes} ${variants}`}>
      {children}
    </button>
  );
}

export function CoinIcon({ src, alt, size = 20 }: { src?: string | null; alt: string; size?: number }) {
  if (!src) return <span className="inline-block shrink-0 rounded-full bg-surface-3" style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} className="shrink-0 rounded-full" loading="lazy" />;
}

/** Pill tabs, CoinGecko style. */
export function Tabs<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-xl bg-surface-3 p-1 text-sm">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg px-3 py-1 font-semibold transition ${o.value === value ? "bg-surface text-fg shadow-card" : "text-muted hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
