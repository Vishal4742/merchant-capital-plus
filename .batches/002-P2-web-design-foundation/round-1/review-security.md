VERDICT: CHANGES

# Security review: 002-P2-web-design-foundation, round 1 (reviewer-security)

Scope: `git diff HEAD -- apps/web` plus the untracked `apps/web/app/tokens.css`, `components/{Button,DitherScene,HoldButton}.tsx`, `lib/dither.ts` and `test/dither.test.mjs`. I left out node_modules and .next, except that I grepped the built chunks to see what ships. I didn't edit any code. I read no `.env` value. Probes ran against the tester's `next start` on :3100, with the Nym, publicnode, jsDelivr, Ankr and Whitechain hosts blocked. Contracts and relayer: nothing in this diff, so there are no contract or relayer findings. I've left out the tester's items (reduced motion, colour space, padding, context loss, busy flash, contrast, console errors, AT on real devices).

One finding blocks this round: S1. A held Enter key confirms the HoldButton over and over. Nothing pays yet, but this is the component that will confirm payments. The fix is two lines and I've checked that it works.

## Findings

### S1. HIGH (latent; nothing pays in this batch): holding Enter confirms again every ~0.5 s
- **Where:** `apps/web/components/HoldButton.tsx:69` (the `detail === 0` click path) and `:42` (done → idle after 450 ms re-arms the button).
- **Exploit sketch, no attacker needed:** the label says "Hold to …", so a keyboard user holds Enter. Chromium sends an auto-repeated click on a focused `<button>` for every repeated Enter keydown. Each click comes with `detail: 0` and `isTrusted: true`. While the button is busy or done the guard drops them. Once it goes back to idle, the next repeat confirms again.
- **Measured:** I held Enter for 2.5 s using CDP `Input.dispatchKeyEvent` with `autoRepeat: true` every 33 ms. Chromium sent **58 clicks, and onConfirm ran 6 times**. I counted runs by the reads of the `mcplus.guestKey` slot, which happens once per sign, and never read the value itself. Space held the same way gives 1 confirm, because Space activates on keyup. A real mouse held for 3 s gives 1.
- **Phase 3 impact:** when onConfirm signs a payment, each repeat signs a fresh EIP-3009 authorization. If the salt is new each time, that's a new nonce and a second payment, unless the contract refuses it (see S5).
- **Fix (I checked it):** cancel auto-repeated keydowns so they can't activate the button.
  ```tsx
  onKeyDown={(e) => { if (e.repeat) e.preventDefault(); }}  // a held Enter must not re-confirm
  ```
  I injected the same thing as a capture listener on the live page. Enter held for 2.5 s then gave **1 click and 1 confirm**. Round 2 should rerun the held-Enter probe and expect exactly 1 confirm.
- **Owner:** claude-frontend.

### S2. LOW: the guards read `phase` as it was at the last render, so a release at ~900 ms can re-arm the button mid-confirm
- **Where:** `HoldButton.tsx:36-56`. `startHold`, `cancelHold` and `onClick` all check the `phase` their render captured.
- **How it happens (from reading the code, not reproduced):** the hold timer's `setPhase("busy")` runs in a timer task, so React renders it later in a separate task. Chrome runs input tasks first. A `pointerup` that lands between the timer and that render runs the old `cancelHold`, which still sees `"holding"` and calls `setPhase("idle")`. The button then shows idle while onConfirm is still running, and a second hold confirms a second time. DEP-3's sign finishes in microtasks, so I couldn't show it on this page. A network-bound pay leaves a window of seconds.
- **Fix:** guard on a ref and keep state only for rendering.
  ```tsx
  const phaseRef = useRef<Phase>("idle");
  const go = (p: Phase) => { phaseRef.current = p; setPhase(p); };  // every setPhase → go; every guard reads phaseRef.current
  ```
- **Owner:** claude-frontend. It's the same edit as S1.

### S3. LOW (defence in depth): `detail === 0` lets any script confirm; `isTrusted` separates scripts from users
- **Where:** `HoldButton.tsx:64-69`.
- **Measured:** each of these ran onConfirm once:
  - `button.click()` (`detail 0`, `isTrusted false`)
  - `dispatchEvent(new MouseEvent("click"))` (same)
  - a scripted `PointerEvent` pointerdown, then pointerup 1 s later

  React doesn't look at `isTrusted`.
- **Why `isTrusted` works:** the HTML spec's `click()` fires its event "with the not trusted flag set". Clicks the browser makes itself (Enter, Space, assistive-tech default actions) are trusted. My Enter probe saw `isTrusted: true`.
- **Fix:** add `e.nativeEvent.isTrusted &&` to `onClick` and `onPointerDown`. Before relying on it, check it with VoiceOver and TalkBack on a real device (this belongs with the tester's open AT item).
- **What it doesn't stop:** same-origin XSS. Such a script can read the guest key straight out of localStorage (`lib/guest-wallet.ts:10`, a known ponytail item). This check only keeps stray scripts and extension content scripts that dispatch events from setting off the button.
- **Owner:** claude-frontend.

### S4. MEDIUM (latent; fix before HoldButton guards money): pages can be framed, and the keyboard path turns that into a two-step clickjack
- **Where:** `apps/web/next.config.ts:3-15` has no `headers()`. The live `/` response has no `Content-Security-Policy` and no `X-Frame-Options`. This predates the batch.
- **Exploit sketch:** an attacker page frames `/pay/…` under a "game".
  1. Step 1, "click here": a quick click focuses the button, and releasing cancels the hold.
  2. Step 2, "press Enter": the instant keyboard confirm fires.

  A "press and hold to charge" game gets past the hold itself.
- **Fix:**
  ```ts
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  }
  ```
  If `apps/shop` will embed checkout in an iframe, allow only that origin. This doesn't block our own sandboxed Nym iframe.
- **Not blocking this round:** `next.config.ts` isn't in this batch's file list, and nothing pays yet. Carry it to the first batch that wires HoldButton to money.
- **Owner:** claude-frontend.

### S5. INFO (carry to the Phase 3 pay batch): the UI lock isn't the real defence against paying twice
- **Frontend:** derive the EIP-3009 `salt` from the payment intent (the checkout session or invoice payment attempt), not at random. A duplicate signature then reuses the same nonce, and USDT's `authorizationState` rejects it. After a successful pay, keep HoldButton in done instead of going back to idle (a terminal-done option, or the parent swaps in the receipt).
- **Question for claude-contracts:** does `paySale` refuse a second payment for the same `orderRef`? Does `payInvoice` cap at what's still owed? ARCHITECTURE §2 puts `salt` into the nonce, so a new salt means a new nonce.
- **Owners:** claude-frontend (salt, pay page) and claude-contracts (once per order, cap at what's owed).

### S6. INFO: notes on the new dependency (nothing to fix)
- `@types/three@0.186.0` pulls in packages that have runtime code: `@dimforge/rapier3d-compat` 0.12.0 (embedded WASM), `fflate` 0.8.3, `meshoptimizer` 1.1.1 and `@tweenjs/tween.js` 23.1.3, plus `@types/webxr` and `@types/stats.js`. They're all `"dev": true`, nothing imports them, and none is in the build output (0 matches for rapier, meshopt or fflate in `.next/static/chunks`). `npm ci` still installs them, Vercel included. None has an install hook, so they don't run.
- three sets `window.__THREE__` and sends `observe` CustomEvents carrying scene objects to `window.__THREE_DEVTOOLS__` when a devtools extension defines it. That's local only, and an extension already has the DOM.
- `next/font/google` downloads the font files from Google at **build** time, with no hash pin. The browser sanitizes fonts (OTS), and nothing calls Google at runtime.

## DONE (what I checked and how)
- **Exact pins:** `package.json` has `"three": "0.186.1"` and `"@types/three": "0.186.0"`, with no `^` or `~`. The lockfile root matches.
- **Lockfile:** compared with `HEAD`, exactly 8 packages were added, none removed, and no versions changed.
  - All 8 resolve to `registry.npmjs.org`.
  - Every sha512 matches `npm view <pkg>@<ver> dist.integrity`.
  - `npm audit signatures`: "383 packages have verified registry signatures", 96 attestations.
  - CI installs with `npm ci` (`.github/workflows/ci.yml:39`), so the lockfile is enforced.
- **Install scripts:** no `hasInstallScript` anywhere in the lockfile. None of the 8 has `preinstall`, `install`, `postinstall` or a `binding.gyp`. tween.js's `prepare` and fflate's `prepack` don't run when installing from the registry.
- **three itself:** zero dependencies. 0.186.1 was published 2026-09-24, 6 weeks ago (0.187.0 came out 2026-10-30). The npm maintainers are mrdoob and mugen87.
- **`npm audit`:** 8 moderate, all in the dev lint chain (typescript-eslint → minimatch 3.1.5, GHSA-g3hv-75wg-m249). They were already there at `HEAD` (same minimatch version), and none is in three.
- **What three pulls at runtime:** one same-origin chunk, `/_next/static/chunks/0qim1xdlnxjks.js` (737 KB), loaded through `import("three")`. Its only network calls are the `fetch(` inside `FileLoader` and `ImageBitmapLoader`, and DitherScene uses neither. I found no `XMLHttpRequest`, `sendBeacon`, `WebSocket`, `Worker`, `eval` or `new Function`. Its only URLs are a doc comment (jcgt.org) and the XHTML namespace.
- **What leaves the browser:**
  - The built CSS loads fonts only from `url(../media/*.woff2)`.
  - The served HTML has no external `src` or `href`, and its `link` preload headers point at `/_next/static/media`.
  - The tester measured `googleFontRequests: 0` and the same hosts as batch 001.
  - DitherScene keeps pointer coordinates inside its closure and sends nothing.
  - The new code has no `console.*` calls.
  - The claude.ai artifact link in the `tokens.css` comment is stripped from the built CSS (0 matches).
  - `lib/dither.ts` touches no DOM, storage, crypto or network.
- **HoldButton probes:** S1 and S3 above. A real mouse held for 3 s gives 1 confirm, a release before 900 ms cancels (tester), and pointerleave and pointercancel cancel.
- **Required grep:** `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 14 diff files gives 3 hits, all already there and all public:
  - `lib/anon.ts:13` `NYM_WORKER_HASH`: matches the ARCHITECTURE pin `0xf13a448a…1fceb8`.
  - `test/guest-wallet.test.mjs:9` `USDT_DOMAIN_SEPARATOR`: I recomputed `hashDomain("Tether USD", "1", 1874, 0xcedf…55a7)` and it matches.
  - `test/guest-wallet.test.mjs:87` `RECEIVE_TYPEHASH`: equals the keccak of the EIP-3009 `ReceiveWithAuthorization(...)` type string.

  I checked each by computing it again, without printing the values. No `PRIVATE_KEY` or `SECRET` hits. The batch folder has 0 hits. N4's zero key is built at runtime (`"0".repeat(64)`), not written as a literal.

## OPEN (owner: claude-frontend)
1. S1: add `onKeyDown` that cancels repeated keydowns. **Required for PASS.**
2. S2: guard on a `phaseRef`. Recommended in the same edit.
3. S3: check `isTrusted` on `onClick` and `onPointerDown`. Recommended.
4. S4: `frame-ancestors 'none'` and `X-Frame-Options: DENY`. Required before HoldButton moves money; can wait for that batch.
5. S5: fixed salt per payment intent and a done state that stays put. Phase 3 pay batch. Contracts question for claude-contracts.

## NEEDS THE USER
- **New dependency** three 0.186.1 and @types/three 0.186.0, flagged under PIPELINE §11. The supply-chain checks are clean (DONE above). With it come six dev-only packages from @types/three that nothing imports.
- **Money idempotency (S5):** should a second signed payment for the same checkout order or invoice be impossible on-chain (contracts) or only in the UI? I recommend on-chain plus a fixed salt.
