import type { ReactNode } from "react";

export type StatusTone = "paid" | "open" | "pending" | "refunded" | "cancelled" | "neutral" | "warning";

interface StatusBadgeProps {
  status: StatusTone;
  label?: string;
  children?: ReactNode;
  className?: string;
}

const TONES: Record<StatusTone, { bg: string; text: string; border: string; dot: string; defaultLabel: string }> = {
  paid: {
    bg: "bg-emerald-50 dark:bg-emerald-950/40",
    text: "text-emerald-700 dark:text-emerald-300",
    border: "border-emerald-200 dark:border-emerald-800/60",
    dot: "bg-emerald-500",
    defaultLabel: "Paid",
  },
  open: {
    bg: "bg-blue-50 dark:bg-blue-950/40",
    text: "text-blue-700 dark:text-blue-300",
    border: "border-blue-200 dark:border-blue-800/60",
    dot: "bg-blue-600",
    defaultLabel: "Open",
  },
  pending: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-700 dark:text-amber-300",
    border: "border-amber-200 dark:border-amber-800/60",
    dot: "bg-amber-500 animate-pulse",
    defaultLabel: "Confirming",
  },
  refunded: {
    bg: "bg-slate-100 dark:bg-slate-800/50",
    text: "text-slate-700 dark:text-slate-300",
    border: "border-slate-200 dark:border-slate-700",
    dot: "bg-slate-400",
    defaultLabel: "Refunded",
  },
  cancelled: {
    bg: "bg-rose-50 dark:bg-rose-950/40",
    text: "text-rose-700 dark:text-rose-300",
    border: "border-rose-200 dark:border-rose-800/60",
    dot: "bg-rose-500",
    defaultLabel: "Cancelled",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-950/40",
    text: "text-amber-800 dark:text-amber-200",
    border: "border-amber-300 dark:border-amber-800",
    dot: "bg-amber-600",
    defaultLabel: "Action required",
  },
  neutral: {
    bg: "bg-surface-sunk",
    text: "text-ink-muted",
    border: "border-hairline",
    dot: "bg-ink-muted",
    defaultLabel: "Status",
  },
};

export function StatusBadge({ status, label, children, className = "" }: StatusBadgeProps) {
  const tone = TONES[status] ?? TONES.neutral;
  const content = children ?? label ?? tone.defaultLabel;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tracking-tight whitespace-nowrap ${tone.bg} ${tone.text} ${tone.border} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${tone.dot}`} aria-hidden="true" />
      <span>{content}</span>
    </span>
  );
}

