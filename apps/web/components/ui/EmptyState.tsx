import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div
      role="status"
      className={`grid content-center justify-items-center gap-3 rounded-[16px] border border-dashed border-hairline bg-surface/50 px-6 py-12 text-center ${className}`}
    >
      {icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </div>
      ) : (
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-sunk text-ink-muted">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
          </svg>
        </div>
      )}
      <div className="grid max-w-sm gap-1">
        <h3 className="text-[16px] font-medium text-ink">{title}</h3>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

