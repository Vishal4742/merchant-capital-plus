// FR-GW-14: one slim strip at the top of pages (the root layout renders it), customer pages included.
// The home/landing page hides this top strip via CSS (body:has(.lp) .test-mode-badge) per explicit user request
// so it does not obstruct the hero presentation, avoiding SSR/prerender URL hook overhead.
export function TestModeBadge() {
  return (
      <div role="note" aria-label="Test mode, Whitechain testnet: no real money moves" className="test-mode-badge eyebrow bg-scene-dot px-3 py-1.5 text-center text-glass-ink">
        <b className="font-medium">Test mode</b> · Whitechain testnet<span className="max-sm:hidden"> · no real money moves</span>
      </div>
  );
}
