import { WhiteflowMark } from "@/components/WhiteflowMark";

// The brand W (components/WhiteflowMark.tsx). Kept under this name for the wordmark below.
export function WhiteflowLogo({ className = "h-4 w-auto" }: { className?: string }) {
  return <WhiteflowMark className={className} />;
}

export function WhiteflowWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-[-0.03em] ${className}`}>
      <WhiteflowLogo className="h-4 w-auto text-accent" />
      <span className="text-[18px] text-ink font-sans">
        White<span className="text-accent">Flow</span>
      </span>
    </span>
  );
}

