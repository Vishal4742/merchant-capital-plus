import { WhiteFlowMark } from "@/components/WhiteFlowMark";

// The brand W (components/WhiteFlowMark.tsx). Kept under this name for the wordmark below.
export function WhiteFlowLogo({ className = "h-4 w-auto" }: { className?: string }) {
  return <WhiteFlowMark className={className} />;
}

export function WhiteFlowWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-[-0.03em] ${className}`}>
      <WhiteFlowLogo className="h-4 w-auto text-accent" />
      <span className="text-[18px] text-ink font-sans">
        White<span className="text-accent">Flow</span>
      </span>
    </span>
  );
}

