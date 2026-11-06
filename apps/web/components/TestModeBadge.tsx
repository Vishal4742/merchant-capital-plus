// FR-GW-14: one slim strip at the top of every page (the root layout renders it), customer pages included. The scene's
// blue in both themes, so it reads the same over the night scene and over the app (light text on it: 8:1).
export function TestModeBadge() {
  return (
    <div role="note" aria-label="Test mode, Whitechain testnet: no real money moves" className="eyebrow bg-scene-dot px-3 py-1.5 text-center text-glass-ink">
      <b className="font-medium">Test mode</b> · Whitechain testnet<span className="max-sm:hidden"> · no real money moves</span>
    </div>
  );
}
