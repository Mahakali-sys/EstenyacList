import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from "react";
import { useEffect, useRef } from "react";
import { SCORE_TIER_COLOR, SCORE_TIERS, scoreTier } from "../lib/types";

/* ------------------------------------------------------------------ */
/* buttons                                                             */
/* ------------------------------------------------------------------ */

type BtnVariant = "primary" | "outline" | "ghost" | "danger";
type BtnSize = "sm" | "md" | "lg";

export function Btn({
  variant = "outline",
  size = "md",
  icon,
  className = "",
  children,
  ...rest
}: {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : ""} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconBtn({
  title,
  className = "",
  children,
  ...rest
}: { title: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`btn btn-ghost btn-icon ${className}`}
      title={title}
      aria-label={title}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* segmented control                                                   */
/* ------------------------------------------------------------------ */

export function Seg<T extends string>({
  options,
  value,
  onChange,
  accent = false,
}: {
  options: { id: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  accent?: boolean;
}) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={value === o.id}
          data-on={value === o.id}
          title={o.title}
          className={`seg-item ${accent ? "seg-accent" : ""}`}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* structure                                                           */
/* ------------------------------------------------------------------ */

export function Label({
  children,
  right,
  className = "",
}: {
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <div className="label-caps">{children}</div>
      {right}
    </div>
  );
}

export function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={`panel ${className}`}>{children}</div>;
}

/* ------------------------------------------------------------------ */
/* chips                                                               */
/* ------------------------------------------------------------------ */

type ChipTone = "plain" | "accent" | "danger" | "moss";

export function Chip({
  tone = "plain",
  onRemove,
  removeTitle = "Remove",
  children,
  className = "",
  title,
}: {
  tone?: ChipTone;
  onRemove?: () => void;
  removeTitle?: string;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      className={`chip ${tone !== "plain" ? `chip-${tone}` : ""} ${className}`}
      title={title}
    >
      {children}
      {onRemove && (
        <button className="chip-x" title={removeTitle} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* progress bar                                                        */
/* ------------------------------------------------------------------ */

export function Bar({
  pct,
  tone = "accent",
  className = "",
}: {
  pct: number;
  tone?: "accent" | "moss";
  className?: string;
}) {
  return (
    <div className={`bar ${className}`}>
      <span
        className={`bar-fill ${tone === "moss" ? "bar-fill-moss" : ""}`}
        style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* checkbox row                                                        */
/* ------------------------------------------------------------------ */

export function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  title?: string;
}) {
  return (
    <label
      className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
      title={title}
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* muted input (inherit look) — re-export for symmetry                 */
/* ------------------------------------------------------------------ */

export function TextInput({
  className = "",
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`} {...rest} />;
}

/* ------------------------------------------------------------------ */
/* empty state                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <span className="text-fg-faint">{icon}</span>
      <div className="display text-[15px] text-fg-muted">{title}</div>
      {sub && <div className="max-w-72 text-xs leading-relaxed text-fg-faint">{sub}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* score face                                                          */
/* ------------------------------------------------------------------ */

// The emoticon is laid out horizontally, then turned 90° clockwise: the
// colon becomes two eyes side by side and the letter drops underneath as
// a mouth (c frowns, I is flat, ) smiles, D grins).
export function Face({
  face,
  size = 12,
  className = "",
}: {
  face: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      aria-hidden="true"
    >
      <span
        className="inline-block font-mono leading-none"
        style={{
          transform: "rotate(90deg)",
          fontSize: `${size}px`,
          letterSpacing: "0.1em",
        }}
      >
        {face}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* score stamp                                                         */
/* ------------------------------------------------------------------ */

export function ScoreStamp({
  score,
  className = "",
}: {
  score: number;
  className?: string;
}) {
  const tier = scoreTier(score);
  if (!tier) return null;
  const color = SCORE_TIER_COLOR[tier];
  const meta = SCORE_TIERS.find((t) => t.tier === tier)!;
  return (
    <span
      className={`stamp h-5 w-5 shrink-0 p-0 ${className}`}
      style={{
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
        color,
      }}
      title={`${meta.label} — ${score}/10`}
    >
      <Face face={meta.face} size={10} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* keyboard hint                                                       */
/* ------------------------------------------------------------------ */

export function Kbd({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={`kbd ${className}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/* escape-key hook                                                     */
/* ------------------------------------------------------------------ */

export function useEscape(active: boolean, onEscape: () => void) {
  const cb = useRef(onEscape);
  cb.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cb.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}
