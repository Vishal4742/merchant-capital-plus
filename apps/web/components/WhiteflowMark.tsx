// The Whiteflow "W": three bars, two diagonal cuts and three rounded tips, traced from the brand construction drawing.
// It takes the current text colour; size it by height (it is about 2.09 times as wide as it is tall).
export function WhiteflowMark({ className = "h-[0.75em] w-auto" }: { className?: string }) {
  return (
    <svg viewBox="0 0 208.61 100" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M0.00 0.00L59.82 0.00L75.41 53.56L49.02 94.29A12.52 12.52 0 0 1 26.49 90.98ZM99.56 5.76A12.63 12.63 0 0 1 122.29 9.10L148.76 100.00L88.94 100.00L73.30 46.29ZM148.48 0.00L208.60 0.00L182.16 90.81A12.76 12.76 0 0 1 159.21 94.18L132.89 53.56Z" />
    </svg>
  );
}
