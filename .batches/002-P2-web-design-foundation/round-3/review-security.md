VERDICT: PASS

# Security review: 002-P2-web-design-foundation, round 3 (reviewer-security)

Scope: `git diff -- apps/web` (8 tracked files) plus the untracked `app/tokens.css`, `components/{DitherScene,Button,HoldButton}.tsx`, `lib/dither.ts` and `test/dither.test.mjs`. Round 2 had no reviewer pass, so this round covers every change since round 1. I didn't edit code, didn't run `npm run build`, and read no `.env` value. The diff touches no contracts, relayer, webhooks, Arkiv or on-chain data, so nothing to report there.

Round 1 asked for one fix before PASS: S1, where a held Enter confirmed again every ~0.5 s. That's fixed and measured. S2 and S3 are fixed and measured too. This round has nothing that must be fixed for PASS. Five items have to go into the spec of the first batch where HoldButton's `onConfirm` signs a payment. Two of them are new this round (D2, D3), and I measured both.

## Round 1 findings, rechecked
| Finding | Status | Evidence |
|---|---|---|
| S1 HIGH: held Enter re-confirms | **Fixed** | `HoldButton.tsx:83` cancels repeated keydowns. On the live page the tester measured held Enter for 2 s: clicks 1, confirms 1 (`round-3/probes/enter-repeat.json`). With CDP autoRepeat for 2.5 s it was 1 sign and 1 click (round 2). I held Space for 2 s with CDP autoRepeat: 1 click, 1 call (`review-security-hold-r3.json`). |
| S2 LOW: stale `phase` re-arms mid-confirm | **Fixed** | The guards read `phaseRef` (`:32`, `:38-42`). On a late release the button stays `Busy` with `callsWithinFlight 1`. The release sweep from 860 to 950 ms is consistent in all 9 runs. |
| S3 LOW: scripts can confirm | **Fixed** | `isTrusted` is checked on pointerdown (`:56`) and on click (`:85`). The round 2 probe measured `element.click()`, a dispatched click and a scripted pointer hold: 0 signs each. Trusted Enter and a trusted mouse hold still give 1 each. |
| S4 MEDIUM latent: framing | **Open, deferred** (D1) | The live `/` on :3100 still sends no `Content-Security-Policy` and no `X-Frame-Options`. `next.config.ts` hasn't changed. |
| S5 INFO: UI lock isn't the double-pay defence | **Open, deferred** (D4) | Nothing has changed here, and the contracts question is still unanswered. |
| S6 INFO: dependency notes | Unchanged | See DONE. |

## HoldButton as a money control: what was measured
All runs use trusted input (Playwright mouse and keyboard, CDP touch and keys) on the real `components/HoldButton.tsx` under React 19 StrictMode.
- **One confirm per deliberate gesture:**
  - mouse held 3 s: 1 confirm (round 1)
  - touch held 1100 ms: 1 confirm (round 2)
  - Enter: 1 confirm; Space: 1 confirm (round 2)
  - Enter held 2 s: 1 confirm (tester, live page)
  - Space held 2 s: 1 confirm (mine)
  - Enter pressed during a pointer hold, then again while busy: 1 confirm in total (mine)
- **No confirm without one:**
  - release before 900 ms: 0
  - right-button hold: 0
  - touch slide-off: 0 (round 2)
  - mouse slides off and back on while held: 0 (mine)
  - a second finger lifts during a hold: 0 (mine)
  - unmount mid-hold, then 1 s more of holding: 0, because the timer is cleared at `:36` (mine)
  - quick click on a `<label>` that wraps the button: 0. The forwarded click arrives with `detail 1`, `isTrusted true`, so the keyboard path ignores it (mine)
- **Repeats:** auto-repeated keydowns are cancelled, and done and busy drop clicks and presses.
- **Not measured:** held Enter in Firefox and WebKit (only Chromium is installed here); real iOS and Android touch; VoiceOver and TalkBack (the tester's NEEDS THE USER).

My probes and their output are in `round-3/probes/review-security-hold-r3.{mjs,json}` and `review-security-hold-props.{mjs,json}`. Both reproduce on a rerun.

## Must-fix for PASS
None. The current `onConfirm` (`page.tsx:155`, `retrySign`) signs a zero-value, self-addressed, already-expired ReceiveWithAuthorization, so it can't move funds.

## Deferrable: put D1–D5 in the pay batch spec, before HoldButton signs a payment (owner claude-frontend unless noted)
The build report sends S4 to batch 003, while the orchestrator puts customer payments in batch 004. Either way, these items exist only in batch folders today, not in HANDOFF or PHASES.

### D1 (was S4). MEDIUM latent: the pages can be framed, and with the instant keyboard confirm that makes a two-step clickjack
- **Where:** `apps/web/next.config.ts:3-15` has no `headers()`. Live `/` → `HTTP/1.1 200 OK` with no CSP and no XFO.
- **Exploit sketch:** an attacker frames `/pay/...` and asks the user to "click here, then press Enter". The click focuses the button and the release cancels the hold. The Enter then confirms at once (`:85`). A "press and hold" game gets past the hold itself.
- **Fix:** send `Content-Security-Policy: frame-ancestors 'none'` (and `script-src 'self'`, see D5) plus `X-Frame-Options: DENY` for `/:path*`. If `apps/shop` embeds checkout, allow only that origin.

### D2. MEDIUM latent (new): a prop change mid-hold runs the action that was there at press time, while the label shows the new one
- **Where:** `HoldButton.tsx:58`. `setTimeout(confirm, HOLD_MS)` captures the `confirm` and the `onConfirm` of the render where the press began.
- **Measured** (`review-security-hold-props.json`):
  1. Press on "Hold to pay 25.00" with action A.
  2. At 400 ms the parent re-renders with "Hold to pay 30.00" and action B. The label mid-hold reads `Hold to pay 30.00`.
  3. The hold completes and runs **A** (`whichRan ["A"]`).
- **Impact in the pay batch:** a quote refresh or amount edit during the 900 ms hold executes something other than what the user saw when they finished the hold.
- **Fix:** cancel a hold in progress when `label` changes: `useEffect(() => { if (phaseRef.current === "holding") cancelHold(); }, [label]);`. Key on the label, not on `onConfirm`, because `retrySign` and most parent callbacks get a new identity on every render. Or have the pay page key the HoldButton by `intentId:amount`, since an unmount mid-hold measured 0 confirms.

### D3. MEDIUM latent (new): the in-flight lock belongs to the component instance, so a remount re-arms it while a payment is still in flight
- **Where:** `HoldButton.tsx:31-32` (state and ref per instance).
- **Measured** (`review-security-hold-r3.json`, `remountWhileBusy`):
  1. Hold, so a 3 s confirm is in flight (1 call).
  2. The parent re-keys the button. The label is back to `Hold`.
  3. A second hold makes `onConfirm` run a second time while the first is still pending (2 calls).

  A remount alone never confirms (`unmountMidHold` 0).
- **Fix:** the pay page owns the "paying" state. While a payment is in flight it renders no idle HoldButton: don't re-key or unmount the button, or pass a controlled `busy`. The real backstop is D4.

### D4 (was S5). MEDIUM latent: back to idle after done (`:50`) and after a rejection (`:52`); the nonce must be bound to the payment intent
- After a successful pay, the button returns to idle 450 ms later, so a second hold pays again.
- After a rejection it returns to idle at once. A relayer timeout doesn't mean the payment failed: the tx may still land, and a retry with a fresh `salt` produces a fresh nonce (ARCHITECTURE §2: nonce = keccak(…, orderRef, amount, salt)), so it pays twice.
- **Fix (frontend):**
  - derive `salt` from the checkout session or invoice payment attempt, and reuse it on every retry, so USDT's `authorizationState` refuses a duplicate
  - keep a terminal done after success (or swap in the receipt)
- **Owner claude-contracts:** answer the round 1 question. Does `paySale` refuse a second payment for the same `orderRef`? Does `payInvoice` cap at what's still owed?

### D5. LOW: a pointer hold isn't cancelled when the page loses focus or the tab is hidden
- **Where:** `HoldButton.tsx:55-70`. Nothing listens for `blur` or `visibilitychange`.
- **Sketch (from reading the code, not reproduced; it needs a real OS focus change):** the mouse goes down on the button, then a window switch or OS overlay steals focus. If neither `pointerup`, `pointerleave` nor `pointercancel` reaches the page, the 900 ms timer confirms.
- **Fix:** while `holding`, cancel on window `blur` and on `document.visibilityState === "hidden"`.

### D6. INFO: scope of the trusted-event guard
A same-origin script could still turn a quick tap into a confirm by swallowing `pointerup` in a window capture listener. Such a script can already read the guest key (`lib/guest-wallet.ts:10`, a recorded ponytail item), so the guard isn't meant to stop it. The defences are NFR-8 (no third-party scripts, which holds today) and the `script-src 'self'` in D1.

## DONE (what I checked and how)
- **`lib/anon.ts` and `lib/guest-wallet.ts`:** all 9 changed lines are `//` comments (checked line by line on `git diff -U0`).
  - The worker-hash pin is the same as at `HEAD`: `anon.ts:13` and `pinWorkerHash` at `:26-38`. The value matches the ARCHITECTURE.md:113 `f13a448a…1fceb8`.
  - The never-overwrite rule is unchanged (`guest-wallet.ts:14-22`).
  - The only test change adds `0x` + 64 zeros to the unreadable cases, built at runtime. It asserts a throw and that the value is left untouched.
  - `npm test`: 16 tests, 16 pass, 0 fail, exit 0.
- **Dependencies:**
  - `package.json` pins `"three": "0.186.1"` and `"@types/three": "0.186.0"` exactly. The lockfile root matches, and installed `node_modules` has the same versions.
  - Against `HEAD` the lockfile adds 8 packages, removes none and changes no versions. It's the same set as round 1. All 8 resolve to `registry.npmjs.org`.
  - I rechecked all 8 `integrity` values against `npm view <pkg>@<ver> dist.integrity` today: 8/8 OK.
  - No `hasInstallScript` anywhere in the lockfile. Only `three` is a runtime dependency; the other 7 come with `@types/three` and are dev-only.
- **Required grep** `(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})` over the 14 diff files gives 3 hits. They're the same 3 as round 1, and all are public:
  - `lib/anon.ts:13` `NYM_WORKER_HASH`: equals `HEAD` and the ARCHITECTURE pin.
  - `test/guest-wallet.test.mjs:9` `USDT_DOMAIN_SEPARATOR`: recomputed with viem `hashDomain("Tether USD","1",1874,0xcedf…55a7)`, and it matches.
  - `test/guest-wallet.test.mjs:87` `RECEIVE_TYPEHASH`: recomputed as keccak of the EIP-3009 `ReceiveWithAuthorization(...)` string, and it matches.

  No `PRIVATE_KEY` or `SECRET` hits in code. In the batch folder, the only file that matches is my round 1 review quoting the regex itself, with no values. My new probe files have 0 hex hits.
- **Client bundle (`.next/static`, build 22:46:44):**
  - App code has no `process.env` or `NEXT_PUBLIC` reference, and `apps/web` has no `.env*` file. It is git-ignored anyway (`apps/web/.gitignore:34`).
  - The 64-hex strings in the chunks are library constants (viem deployless bytecode, the ERC-6492 magic value, noble secp256k1 parameters), plus the worker hash and the zero nonce.
  - No secret-looking names appear.
  - External hosts are library doc links plus the batch 001 RPC hosts.
- **Trackers and fonts:** `next/font/google` self-hosts at build time, and the tester measured `googleFontRequests 0` with the same host list as batch 001.
  - DitherScene keeps pointer coordinates in its closure, has no network or storage calls, and disposes and loses the GPU context on unmount (tester round 2).
  - `lib/dither.ts` is pure.
  - The new CSS imports only Tailwind and `./tokens.css`, with no `url()`.
- **Button:** while `aria-disabled` it drops `onClick` (`Button.tsx:28-30`), and the `{...props}` spread can't bring back a handler that was already destructured out.

## OPEN
1. D1–D5 go into the pay batch spec (owner claude-frontend). D4's contract question goes to claude-contracts.
2. Since lanes don't edit the shared docs, claude-research should record D1–D5 as pay-batch preconditions in HANDOFF, so they don't live only in a closed batch folder.

## NEEDS THE USER
- **New dependency** three 0.186.1 and @types/three 0.186.0 (PIPELINE §11). The build report says you approved it at the 001 gate (21:58). I found no record of that in HANDOFF, so please confirm it. The supply-chain checks are clean (DONE).
- **Double pay (D4):** should a second signed payment for the same checkout order or invoice be impossible on-chain, or blocked only in the UI? I recommend on-chain, plus a salt bound to the intent.
