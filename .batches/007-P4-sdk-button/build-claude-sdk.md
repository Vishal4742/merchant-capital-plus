STATUS: READY

# Build: 007-P4-sdk-button (claude-sdk)

## Round 2 (round 1: code CHANGES H1+H2, security CHANGES HIGH-1 = H1; tester and ux-ui PASS)
Diff: `git diff 3e48d40..HEAD`.
- **H1 (both reviewers) DOM clobbering.** `currentScript` is now read through `Object.getOwnPropertyDescriptor(Document.prototype, "currentScript").get.call(document)` and must be `instanceof HTMLScriptElement`.
  - An `<img name="currentScript">` can no longer set the origin; the buttons keep working on the real gateway.
  - The guard flag is `window.__mcPayButton !== true`, so a `<div id="__mcPayButton">` can't switch the listener off.
  - A shop handler that called `preventDefault()` now cancels the redirect.
  - **Size:** the cap went from 2 KB to 2.5 KB (now 2,248 bytes) for the guard and the comment that stops it being "simplified" back.
- **H2 (code) amount formats.** `sameAmount(a, b)` compares base units, so "1,000.00" = "1000.00" = "1000". The README's webhook check uses it.
  - Cross-lane: claude-frontend agreed one `plainUsdt` for sessions, payments and webhooks (03:44-03:45). It never rounds and keeps up to 6 decimals; FX sessions are rounded to the cent at creation.
- **LOW, folded in:**
  - the currency-mismatch error goes through `#scrub`;
  - `baseUrl` is rebuilt from origin + path, so a bare `?` or `#` no longer drops the path prefix;
  - the pk_ error text no longer mentions the button.
- **README:** use `<body>`, one gateway per page, strip `data-mc-*` from user content (security MEDIUM-1), restyle with your own element, the 1–64 character id limit, silent bad ids by design, and `preventDefault` cancels.
- **Tests:** a fake `Document.prototype` getter plus an `HTMLScriptElement` class in the vm context, covering clobbering, a non-script `currentScript`, the clobbered guard, `defaultPrevented`, no extra globals, `sameAmount`, the bare `?`/`#`, and the scrubbed currency error.
- **Evidence:**
  - `npm test` → `ℹ tests 47 · ℹ pass 47 · ℹ fail 0`; tsc exit 0; `wc -c button.js` → 2248; `cmp` → identical.
  - **Live run** against the real route (main working tree; claude-frontend's sessions v2 is there now): the 401 now carries the hint.
  - **New EUR/USD run** (`scratchpad/sdk-eur.ts`): `EUR -> {"amount":"28.13","currency":"EUR","priced":{"currency":"EUR","amount":"25.00","rate":"0.88879",…,"source":"frankfurter.dev"}}` and `USD -> {"amount":"25.00","currency":"USD","priced":{…"rate":"1",…}}`. The guard now passes for the right reason, after refusing EUR on the old route.

## Round 1

Commits on branch `sdk` (pushed): `b5ceb00` test RED, `3e48d40` feat GREEN. Diff: `git diff c81b330..3e48d40`.

## What was built
- **`packages/sdk/button.js`** (2,026 bytes, ES5-style, no dependencies, no requests):
  - **Script-tag mode:** `<script src=…/v1/button.js data-session=ID | data-link=SLUG [data-label]>` inserts one `<button type="button" class="mc-pay-button">` after itself. The label is set with `textContent`; the style is inline (brand `#3b4fd9`, white text, contrast ≈ 6.3:1).
  - **Clicks:** one delegated `click` listener on `document`, installed once (guard `window.__mcPayButton`), handles any `[data-mc-session]` / `[data-mc-link]` element. That covers both shop-written and React-rendered buttons.
  - **Navigation:** `location.assign(<script origin>/checkout/<id> | /l/<slug>)`.
  - **Input check:** an id or slug must match `^[\w-]{1,64}$`; otherwise there's no button and no navigation, just one `console.error`.
- **`apps/web/public/v1/button.js`:** a byte-identical copy, served statically by Next at `<web>/v1/button.js` (claude-frontend agreed 03:13). A test compares the two files.
- **`index.ts` follow-ups from batch 005:**
  - a `baseUrl` with a username, password, `?query` or `#hash` is refused;
  - every error message goes through `#scrub`, the network error and the server's `json.error` alike;
  - a non-string `orderId` is refused;
  - config mistakes (no secret, bad `toleranceSec`) are plain `Error`s (500), not `WebhookSignatureError`;
  - a 401 adds "Check GATEWAY_SECRET_KEY and that baseUrl is the right gateway."
- **`README.md`:**
  - a button section;
  - the shop's own helpers are marked as such;
  - orders are credited on the stored session id plus the stored amount;
  - `event.id` is recorded in the same transaction as marking the order paid;
  - config errors are rethrown as a 500.

## Evidence
- RED: 8 of 32 tests failed before the code, all of them the new or changed ones.
- GREEN: `npm test` → `ℹ tests 39 · ℹ pass 39 · ℹ fail 0`; `npx tsc --noEmit` → exit 0.
- `wc -c button.js` → 2026; `cmp packages/sdk/button.js apps/web/public/v1/button.js` → identical.
- The fake-DOM harness first failed because my fake `<script>` lacked the `.src` property a real one has. That was a test-harness bug, fixed in the test, not in `button.js`.

## Decisions
- **Redirect-first, no overlay or iframe:** no CSP `frame-src` needed, and no postMessage surface.
- **Inline styles, not an injected `<style>`:** they survive a strict `style-src` CSP. A shop that wants its own look writes its own `data-mc-session` element.
- **No `pk_` route,** so `data-key`, `data-amount` and `data-currency` are ignored (claude-research 02:55).
- **No SRI hash:** the file updates in place at `/v1/`, so a pinned hash would break; Stripe.js doesn't support SRI for the same reason.

## Not verified here (tester)
- The real-browser walk, at 375 and 1440, light and dark, keyboard and focus.
- A click and an Enter press landing on the stub gateway's `/checkout/<id>` and `/l/<slug>`.
