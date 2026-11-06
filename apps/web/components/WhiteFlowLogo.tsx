import type { SVGProps } from "react";

export function WhiteFlowLogo({ className = "h-6 w-6", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      {...props}
    >
      {/* Background soft teal circular shield */}
      <rect width="28" height="28" rx="7" fill="currentColor" fillOpacity="0.12" />
      {/* Interlocking fluid settlement flow paths */}
      <path
        d="M7 10.5C7 8.567 8.567 7 10.5 7H14.5C16.433 7 18 8.567 18 10.5C18 12.433 16.433 14 14.5 14H9.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 17.5C21 19.433 19.433 21 17.5 21H13.5C11.567 21 10 19.433 10 17.5C10 15.567 11.567 14 13.5 14H18.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Precision settlement anchor dots */}
      <circle cx="10" cy="10.5" r="1.3" fill="currentColor" />
      <circle cx="18" cy="17.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function WhiteFlowWordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-[-0.03em] ${className}`}>
      <WhiteFlowLogo className="h-6 w-6 text-accent" />
      <span className="text-[18px] text-ink font-sans">
        White<span className="text-accent">Flow</span>
      </span>
    </span>
  );
}

