"use client";

export type ZeroMarkState = "idle" | "thinking" | "speaking" | "working";
export type ZeroMarkSize = "compact" | "standard" | "hero";

export interface ZeroMarkProps {
  state?: ZeroMarkState;
  size?: ZeroMarkSize;
  label?: string;
  className?: string;
}

const sizeClass: Record<ZeroMarkSize, string> = {
  compact: "h-7 w-7 text-[10px]",
  standard: "h-9 w-9 text-xs",
  hero: "h-12 w-12 text-sm",
};

/**
 * Canonical Titan Zero mark used by the Zero/Go/Hub chat surfaces.
 * Presentation-only: state changes visual affordance and never grants authority.
 */
export function ZeroMark({
  state = "idle",
  size = "standard",
  label = "Titan Zero",
  className = "",
}: ZeroMarkProps) {
  const active = state === "thinking" || state === "speaking" || state === "working";
  return (
    <span
      role="img"
      aria-label={`${label} — ${state}`}
      data-zero-state={state}
      className={[
        "inline-flex shrink-0 items-center justify-center rounded-full border border-slate-700",
        "bg-black font-semibold tracking-tight text-white shadow-sm",
        active ? "ring-2 ring-orange-500/40" : "",
        sizeClass[size],
        className,
      ].filter(Boolean).join(" ")}
    >
      T0
    </span>
  );
}
