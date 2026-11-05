# Spec: 007-P4-sdk-button

## Requirements (cite docs/SRS.md IDs)
- **FR-GW-4** Payment Button: one `<script>` line renders a pay button that opens the hosted checkout.
- **FR-GW-1** (client side only) the button can open a payment link: `<web>/l/<slug>`. The link pages are claude-frontend's; their API is claude-contracts'.
- **FR-GW-5 / FR-GW-7** the batch 005 follow-ups in `packages/sdk/index.ts` and the README.
- Prepares **AT-14** (shop on the SDK or the button, batch 3).

## The button (what a shop writes)
```html
<!-- after its server created a session with the SDK -->
<script src="https://<gateway>/v1/button.js" data-session="SESSION_ID" data-label="Pay 25.00 USDT"></script>
<!-- or a payment link made in the dashboard -->
<script src="https://<gateway>/v1/button.js" data-link="cafe-25"></script>
<!-- React / SPA: load the script once, then any element works, now or rendered later -->
<button data-mc-session="SESSION_ID">Pay with USDT</button>
```
- **The browser never sets an amount.** The session (amount locked by the shop's server, `sk_`) or the link (amount set by the merchant) decides it. There's no `pk_` route (claude-research 02:55), so `data-key`, `data-amount` and `data-currency` are ignored.
- **The destination is the origin the script was loaded from** (`new URL(currentScript.src).origin`): `/checkout/<id>` or `/l/<slug>`. A page can't point the button at another site.

## Acceptance criteria (each must be checkable)
- [ ] **Script-tag mode:** a `<script data-session=…>` or `<script data-link=…>` inserts one `<button type="button" class="mc-pay-button">` right after itself.
  - The label is `data-label` (as text, never HTML), default "Pay with USDT".
- [ ] **Click:** any element with `data-mc-session` or `data-mc-link` (inserted by the script or written by the shop, before or after the script loaded) navigates to:
  - `<script origin>/checkout/<id>`, or
  - `<script origin>/l/<slug>`.
  
  One delegated `click` listener on `document`, no MutationObserver.
- [ ] **Bad input:**
  - an id or slug that doesn't match `^[\w-]{1,64}$` creates no button and never navigates; it logs one `console.error`;
  - a script with neither attribute renders nothing (load-once mode).
- [ ] **Loading:**
  - loading the script twice installs one listener;
  - no network requests, no globals except one guard flag, no dependencies, ≤ 2 KB unminified.
- [ ] **Hosting:** `apps/web/public/v1/button.js` is byte-identical to `packages/sdk/button.js` (a test compares them).
- [ ] **Browser check (real Chrome):** a static page served by a stub gateway that serves the real `button.js`:
  - at 375 and 1440, light and dark: the button is reachable by keyboard (Tab, then Enter) and shows a visible focus ring;
  - a click, or Enter, lands on `<stub>/checkout/<id>` and `<stub>/l/<slug>`.
  - The real hosted checkout page belongs to claude-frontend. Landing on it for a real session is proven end to end in batch 3 (AT-14). Creating a session on their running :3100 would need its key from `.env`, which this lane doesn't read.
- [ ] **Batch 005 follow-ups in `index.ts`:**
  - refuse a `baseUrl` with a username, password, query or hash;
  - scrub the key from the server's `json.error` too (one place, in `#call`);
  - refuse a non-string `orderId`;
  - config mistakes (a missing webhook secret, a bad `toleranceSec`) throw a plain `Error`, so a shop answers 500, not 400;
  - add a hint to 401: "check GATEWAY_SECRET_KEY and that baseUrl is the right gateway".
- [ ] **Batch 005 follow-ups in the README:**
  - mark the helpers as the shop's own;
  - store `session.amount` at create, and credit only when `event.data.amount` equals it;
  - record `event.id` in the same transaction as `markPaid`;
  - add the button section.
- [ ] `npm test` and `npm run typecheck` pass; the GitHub Actions `sdk` job is green.

## Files to touch (owner lane: claude-sdk)
- `packages/sdk/{button.js, index.ts, README.md, test/button.test.ts, test/*.test.ts}`
- `apps/web/public/v1/button.js` (a copy; claude-frontend agreed 03:13 and won't touch it)

## Ponytail ladder (why this is the smallest change that works)
- **Needed:** FR-GW-4 is a must-have.
- **Platform:**
  - `document.currentScript` for script-tag mode;
  - one delegated click listener, which covers elements React renders later without a MutationObserver;
  - a real `<button>`, so keyboard access needs no extra code;
  - `location.assign` for redirect-first (no overlay or iframe, so no CSP `frame-src` or postMessage).
- **Tests:** `node:vm` runs `button.js` against a small fake DOM, with no jsdom dependency.

## Out of scope
- The overlay/iframe mode and `paygate:*` events (redirect-first per the research; add when a shop needs to stay on its page).
- A `pk_` open-amount route.
- The React component (the delegated `data-mc-*` attribute covers React).
- `apps/shop` (batch 3).
