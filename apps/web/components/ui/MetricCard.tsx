import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  unit?: string;
  subtext?: ReactNode;
  tone?: "up" | "down" | "neutral" | "positive";
  icon?: ReactNode;
  className?: string;
}

export function MetricCard({ label, value, unit, subtext, tone = "neutral", icon, className = "" }: MetricCardProps) {
  const toneClasses = {
    up: "text-positive",
    positive: "text-positive",
    down: "text-warning",
    neutral: "text-ink-muted",
  }[tone];

  return (
    <div className={`grid content-start gap-1.5 rounded-[16px] border border-hairline bg-surface p-5 transition-shadow hover:shadow-card ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow text-ink-muted">{label}</span>
        {icon && <span className="text-ink-muted">{icon}</span>}
      </div>
      <div className="flex items-baseline gap-1.5">
        <b className="text-[28px] leading-none font-semibold tracking-[-0.03em] tabular-nums text-ink">
          {value}
        </b>
        {unit && <span className="eyebrow text-ink-muted">{unit}</span>}
      </div>
      {subtext && <p className={`text-xs ${toneClasses}`}>{subtext}</p>}
    </div>
  );
}

