export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[8px] bg-surface-sunk/80 ${className}`}
    />
  );
}

export function MetricSkeleton() {
  return (
    <div className="grid gap-2 rounded-[16px] border border-hairline bg-surface p-5">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-3 w-28" />
    </div>
  );
}

export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-hairline py-4">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === 0 ? "w-44" : i === cols - 1 ? "w-20" : "w-24"}`}
        />
      ))}
    </div>
  );
}

