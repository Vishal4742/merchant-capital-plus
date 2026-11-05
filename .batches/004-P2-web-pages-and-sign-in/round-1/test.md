VERDICT: CHANGES

# Test report: 004-P2-web-pages-and-sign-in, round 1 (tester)

Almost everything holds. Every money-path rule has a test that fails when the rule is broken: 25 of 25 mutants killed. In a real browser the pay pages show no crypto words, make 0 requests to other origins and raise 0 CSP violations. /checkout ships 179,600 B of JS. The HoldButton guards hold on the real page.

Three things fail against the spec:
1. A malformed signature crashes the pay route with a 500. The spec says a mismatch is a 400.
2. The CSP isn't in force when /checkout is reached from our own "Try a checkout" or "Open a test checkout" buttons.
3. The dashboard leaves out "gas spent today", which FR-REL-6 lists.

All three have small fixes. Two items need the human: Lighthouse itself, and permission for the live chain test.

## Setup
- **Server.** The existing `next start` on :3100, pid 16475, started 00:10:45. `.next/BUILD_ID` is from 00:10:33, and `find app components lib next.config.ts -newer .next/BUILD_ID` is empty, so the build matches the source. I didn't rebuild or restart anything.
- **Relayer.** 127.0.0.1:8787. `/relay` answers `paySale` with 400 "unknown action (Phase 1 supports "pull")" (`apps/relayer/src/relayer.ts:72,100`). That can't create a pending checkout.
- **Secrets.** I read `SHOP_API_KEY` into a shell variable and never printed it. I read no other `.env` value. The SIWE probe makes a throwaway key in memory and never writes or prints it. `grep -rlE '0x[0-9a-fA-F]{64}\b' round-1/probes/` exits 1, and so does a grep for `SHOP_API_KEY=|AUTH_SECRET=`.
- **Mutations.** Done only in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/t004/web`. The only repo file I touched is the new test file `apps/web/test/checkout-edges.test.mjs`.
- **Product code changed after my runs.** At 00:53–00:54, while I was writing this report, these files changed:
  - `test/{checkout-api,checkout-edges,settle}.test.mjs`
  - `app/api/v1/sessions/[id]/pay/route.ts` and `app/api/v1/sessions/[id]/route.ts`
  - `lib/{relay,sessions,settle,sign-sale}.ts`
  - `components/Checkout.tsx`

  The pay route now has a comment about malformed signatures, and the `todo` option on my OPEN 1 test is gone. **None of those edits is tested here.** Every result below is for the 00:10:33 build and the source as it stood before 00:53 (my last `npm test` ran at about 00:52). Round 2 should test the new code.
- **Probes and output.** Everything is in `round-1/probes/`: `walk.mjs`, `hold-checkout.mjs`, `signin.mjs`, `expired.mjs`, `perf.mjs`, `csp-softnav.mjs`, `lh-estimate.py`, `mutate.py`, plus their `.json`, `.out` and `.log` files and `api-live.log`. The `review-*` files in the same folder belong to the reviewers.

## Commands
| Check | Result |
|---|---|
| `npm test` (apps/web) | exit 0. Before my file: `tests 60 · pass 59 · fail 0 · skipped 1`. With `checkout-edges.test.mjs`: `tests 76 · pass 74 · fail 0 · skipped 1 · todo 1` (`probes/npm-test.log`, `npm-test.summary`) |
| `npx tsc --noEmit` | exit 0 (no `next typegen`, so `.next` stays as served) |
| `npm run lint` | exit 0, with my test file included |
| `npm run build` | not run: it would overwrite the `.next` that :3100 serves. ci runs it. The served build is current (see Setup). |
| `LIVE=1 node --test test/onchain.live.test.mjs` | **not run**: the permission classifier denied it ("Modify Shared Resources"). See NEEDS THE USER. |

## Mutation run (scratch copy only)
`python3 mutate.py <scratch>/web` applies each mutant, runs the whole suite, then restores the file. The baseline in scratch is 74 pass and 0 fail. Output: `probes/mutants.log`.

- **All 25 mutants killed.** They cover:
  - the in-flight claim, the signature check, and payer, merchant and gross in the consumer rule;
  - replay mapped to unlock, 5xx mapped to a plain failure, a timeout mapped to "not sent", and no chain check on a 422;
  - recording a relayer 200 without the chain, the 60 s clock margin, reopening on a failed read, and falling back to a later block;
  - KIND_SALE = 1, a plain nonce cookie, no SIWE expiry, and each `validBefore` bound;
  - an expired checkout being payable, the max amount, items not adding up, and the dashboard listing every merchant;
  - a Bearer check that accepts any token, pending ignored on pay, and session expiry ignored.
- **Seven of those need my new tests.** With only the builder's tests (`probes/mutants-builder-only.log`), these survived: M11 (no 60 s margin), M12 (reopen on a failed chain read), M17 and M18 (`validBefore` bounds), M19 (an expired checkout payable), M20 (no 10,000 cap) and M22 (the dashboard lists other merchants' payments).

## Acceptance criteria (spec.md)
| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `POST /api/v1/sessions`: constant-time Bearer, 401 | PASS | `config.ts:26-31` (sha256 then `timingSafeEqual`). Live: no key gives 401, wrong key gives 401 (`api-live.log`). Test "creating a checkout needs the shop's key"; M23 killed. |
| 1 | amount format, 6 dp, 1–10,000; items ≤ 20, qty 1–999, must add up | PASS | Live: 0.50 gives 400; 30.00 against items worth 20.00 gives 400 "Items add up to 20.00…". New tests: 1.00 and 10,000.00 give 201, 10,000.01 gives 400, 20 items give 201, 21 give 400, qty 0/1000/1.5/−1 give 400, qty 999 gives 201, a 7 dp price gives 400. |
| 1 | 201 `{id, url, amount, expiresAt}`, 30 min | PASS | Live 201 with exactly those keys. The new test checks the keys and that `expiresAt` is 30 min ± 1 s. The live session reached `expired` on its own at 19:20:46Z. |
| 2 | `GET /api/v1/sessions/:id`: 401, 404, open → paid, pending → paid, expired | PASS | Live: 401 without the key, 404 for an unknown id, `open`, and later `expired`. Tests "the shop polls…" and "polling a pending checkout asks the chain…". New: an expired open checkout gives "expired" and a paid one stays "paid". |
| 3 | pay: 404 / 409 (paid, with receiptId) / 410 / 503 | PASS | Live: 404, and 410 on the expired session. Tests cover 503 (no relayer) and 409 with `receiptId` (new). M19 killed. |
| 3 | pay validates `from`, `salt`, `signature`, `validBefore` (now+30 s … now+15 min); browser uses 465 s | PASS | New test: malformed from, salt, signature or validBefore gives 400 with 0 relay calls; now+30 gives 400, now+902 gives 400, now+465 gives 200. Live browser POSTs carry `validBefore − now = 465` (`hold-checkout.json` F). |
| 3 | rebuilds the sale and checks the signature before relaying; **a mismatch gives 400** and the relayer isn't called | **FAIL** | A wrong amount, a wrong signer or another order gives 400 with 0 relay calls (tests). **A malformed 65-byte signature gives 500 with an empty body** (live, `api-live.log`). `verifyTypedData` throws "Invalid yParityOrV value", "expected valid r…" or "Point is not on curve" at `app/api/v1/sessions/[id]/pay/route.ts:38`, and nothing catches it. The relayer isn't called, so no money is at risk. See OPEN 1. |
| 3 | consumer rule: read at the receipt's block, 5 × 1 s retry, never a later block; gross, payer and merchant must match | PASS | `onchain.test.mjs` (4 tests). M3, M4, M5, M10 and M13 killed. |
| 4 | one payment in flight (409); one salt per checkout | PASS | Test "two payments at the same moment" (M1 killed). In the browser, two attempts in one tab sent the same salt and the same `from` (`hold-checkout.json` F: `sameSalt: true`). |
| 4 | pending on timeout, dropped connection, 502/5xx, 422 replay, or an unconfirmed 200, with the "Don't pay again" copy | PASS | Builder tests plus a new 500 test. M6, M7, M8 and M24 killed. |
| 4 | the chain settles a pending checkout on the next pay and on the poll (paid → recorded; past validBefore + 60 s → open; else 409) | PASS | Tests, plus new: 30 s past validBefore is still 409, 61 s past reopens, and a failed chain read never reopens. M11 and M12 killed. |
| 4 | … and on page load | PASS (code only) | `app/checkout/[sessionId]/page.tsx:31` calls `settlePending`. Not reachable live: that needs a real pending session, which I was told to create only through the tests. |
| 4 | unlock only when nothing was sent: 422 (chain checked first), 503, 429, ECONNREFUSED/ENOTFOUND/EAI_AGAIN | PASS | Tests, plus new ENOTFOUND and EAI_AGAIN cases. M9 killed. |
| 4 | a browser→server fetch that throws marks the page pending | PASS | Browser: an aborted pay POST shows "We couldn't confirm this payment yet. Don't pay again…" with no button (`walk-*.json` `checkout-pending-dropped`, 4 runs). |
| 4 | the relayer's own error text never reaches the customer | PASS | Test "a 422 … without relayer text". Live: the relayer's "supports pull" became "The payment didn't go through. Nothing was charged." |
| 5 | `/checkout`: StaticScene, Suspense, the approved sheet, "Hold to pay 25.00", "You pay exactly 25.00 USDT. No fees for you." | PASS | `shots/checkout-ready-{375,1440}-{light,dark}.png`. The text matches (`walk-1440-light.json`). |
| 5 | states: ready, expired, not live, error, pending, paid | PASS (5 live, 1 by code) | Live: ready; **expired**, reached naturally, with no button (`expired.json`, `shots/checkout-expired-*`); error (a real attempt, refused by the relayer, back to idle); pending (aborted POST, and a 504 reply); paid (a 200 reply in the browser only, showing the receipt inline). "Not live" can't be reached without restarting the server; its copy at `Checkout.tsx:160` passes the word scan. |
| 5 | the signer loads when idle | PASS | `perf-checkout.json`: the signer chunk `0bfd4-0ak6bmj.js` (7,230 B) starts at 1,629 ms, after load (FCP 632 ms). It isn't in the first-load scripts. |
| 5 | an unknown id gives Next's 404 with `noindex` | PASS | curl and the DOM both show `HEAD:noindex` and `BODY:noindex` (`expired.json` robots). |
| 6 | `/r/[id]`: amount, shop, IST time, order, refund from `payments(id).refunded` (1.5 s cap), explorer link or "Payment number N…" | PASS (code and unit only) | A paid receipt can't be reached live. `onchain.test` covers `paymentRefunded`. `r/[id]/page.tsx:14-27` caps the read at 1.5 s and clears the timer. An unpaid id shows the 404 (`shots/receipt-unpaid-*`). See OPEN 4 for the LCP risk. |
| 7 | Home: hero over DitherScene with the wash; "Try a checkout" creates a session and redirects; "How it works"; proofs at `/proofs` | PASS | `shots/home-*`. "Try a checkout" landed on a new `/checkout/<id>` (`hold-checkout.json` I). `/proofs` returns 200 (`shots/proofs-1440-*`). |
| 8 | `/merchant` signed out shows the "Sign in with your wallet" gate | PASS | `shots/merchant-signed-out-*`. With no browser wallet, the click shows "No browser wallet found. Install MetaMask…" (`signin.json`). |
| 8 | signed in: "Sales, before fees", relayer health with unswapped fees, payments table, sign out | PASS (E2E with an injected provider) | `signin.mjs`: a real EIP-1193 provider in the page calls `eth_requestAccounts` then `personal_sign`, and the dashboard shows "Signed in as 0x6008…4b20". Sales, before fees: 0.00. Relayer balance, Fees not yet swapped and Status show. Sign out brings the gate back and removes the cookie. 1440 and 375, `shots/merchant-signed-in-*`. |
| 8 | nonce cookie `nonce.issuedAt.HMAC`, HttpOnly, Lax; verify: 5 min, our domain, chain 1874, expiry ≤ 10 min, `verifyMessage`; `mc_session` 8 h, Secure on https; nonce cleared | PASS | `auth.test.mjs` (9 tests) and new cookie-flag tests. In the browser: `mc_session` is `httpOnly: true, sameSite: Lax`, lasts 8 h, and no `mc_nonce` is left. M15, M16 and M25 killed. See OPEN 5 on replay inside the window. |
| 8 | forged plain nonce cookie gives 401; edited, wrong-secret or old cookie refused; no expiry or a 1-day expiry refused | PASS | Tests. Live: replaying the captured verify body with a hand-made plain `mc_nonce` cookie gives 401, and with no cookie gives 401. |
| 8 | logout clears the session; no `AUTH_SECRET` gives 503 | PASS | New test (exact `Set-Cookie`, Max-Age=0). Test "sign-in is off…". |
| 8 | each wallet sees only its own payments; other wallets get the `MERCHANT_ADDRESS` note | PASS | New test (`listPayments` for another address gives `[]`; M22 killed). Browser: "The demo shop is paid to 0xb4E7…714D, not this wallet…". |
| 9 | HoldButton: a label change mid-hold cancels | PASS | 002 `review-security-hold-props.mjs`, re-run on the current component: `labelMidHold "Hold to pay 30.00", calls 0` (`probes/002-review-security-hold-props.out`). |
| 9 | remount while busy: no second call | PASS | On the real page: pay in flight, then back to /, then forward. The label is still "Paying", a second Enter and a 1.2 s hold make 0 new POSTs (1 in total), and the reply returns it to idle (`hold-checkout.json` I). The standalone r3 probe shows `callsAfterSecondHold 2` for the bare component, as expected, because the page owns the in-flight payment (`Checkout.tsx:43,56`). |
| 9 | blur or a hidden tab mid-hold cancels | PASS | Real page: blur at 400 ms gives 0 POSTs; `visibilitychange` at 400 ms gives 0 POSTs. These are synthetic events, because Playwright fakes focus. The control (a full hold) gives 1 POST. |
| 9 | success leaves the receipt, never an idle button | PASS | `hold-checkout.json` G: 0 buttons, a "Paid" pill, and a "View receipt" link to `/r/<id>`. A 409 hides the button (H). |
| 9 | the scene draws after a hidden route is shown again; a hidden "done" comes back as "Hold" and confirms once | PASS | Real home page: / to /merchant and back gives `drawsWhileHidden 0`, `drawsAfterShow 88`, `contextLost false` (J). 002 `review-code-activity-remount`: `drawsAfterShow 41`. `review-code-activity-hold`: "Hold" after showing again, then one more call. |
| 9 | (extra) touch slop and held Enter | PASS | Touch hold gives 1. Drifting 8 px outside the edge still gives 1 (12 px slop). 40 px outside gives 0. Enter held 2 s with auto-repeat gives 1 POST. |
| 10 | headers: XFO DENY, nosniff, Referrer-Policy everywhere; strict CSP on `/checkout` and `/r`; none on home and `/proofs` | PASS | curl -I on every route (`api-live.log`). |
| 10 | 0 `securitypolicyviolation`, every script same-origin | **FAIL (on one path)** | 0 violations and 0 off-origin scripts in all 4 walks and 15 perf runs. But **the CSP isn't in force when /checkout is reached by Next's client-side navigation**. From home's "Try a checkout", a `fetch("https://csp-probe.example/x")` goes out with 0 violations. After a full reload of the same page it is blocked with 1 violation and no request (`probes/csp-softnav.out`). See OPEN 2. |
| 11 | FR-PAY-7 / FR-PRIV-1 scan: no `/\b(sign\|gas\|wallet\|whitechain\|chain)\b/i`, 0 third-party requests, in every reachable state | PASS | 4 walks × (ready, pending ×2, paid, unknown-404, receipt-404), plus error ×2 and expired ×4: `cryptoWord: null` and 0 off-origin requests every time. The unreachable copy ("not live", paid receipt, `relay.ts` messages) passes a static scan. INFO: some 400s for malformed clients mention "signature"/"hex" (`pay/route.ts:28-31`); a real customer never sees them. |
| 12 | NFR-12: `.js` encodedBodySize after the idle signer ≤ 204,800 B | PASS | **179,600 B**: 11 files, 172,370 app + 7,230 signer. Same in 6 runs on /checkout. No three.js chunk and no Nym on /checkout or /r. /r: 137,245 B. |
| 12 | NFR-12 LCP ≤ 2000 ms, INP ≤ 200 ms, perf ≥ 90 | PASS (lab-equivalent, **not Lighthouse**) | See the Speed section. Perf ≥ 90 is an estimate from Lighthouse's scoring curves, not a Lighthouse run. |
| 13 | NFR-13: on / and /merchant, three.js and the Nym worker start after FCP | PASS | /: the three.js library chunk (`0qim1xdlnxjks.js`, 184,342 B, three r186) starts at 1,491 ms against an FCP of 628–636 ms in all 3 runs. The 6 KB DitherScene chunk loads with the page; it holds no three.js code. /merchant: no three.js and no Nym; only the prefetched 6 KB scene component, at 2.16 s (FCP 620 ms). Nym: 0 requests on either page; it moved to `/proofs`. |
| 14 | `npm test` 0 failures with the named money-path tests | PASS | All named tests are present and pass (see Commands). |
| 14 | `LIVE=1 … onchain.live.test.mjs` passes | NOT RUN | Denied by the permission classifier. The builder reports it passed in 1.8 s. See NEEDS THE USER. |
| 15 | typecheck, lint, build; shots at 375 and 1440, light and dark | PASS | tsc 0, lint 0, build served (see Commands). 94 shots by the tester. I didn't shoot a pending state loaded from the server, for the reason above. |
| FR-REL-6 | the dashboard shows WBT, **gas spent today**, budget left, unswapped fees, paused | **FAIL (one field)** | `app/merchant/page.tsx:112-129` renders balance, budget, unswapped fees and status. There is no row for `gasSpentToday`, although `lib/relay.ts:75,88` parses it. See OPEN 3. |
| AT-1 (partial) | shop creates the session, the customer holds, our server verifies and calls `/relay`, the shop polls | PASS up to `/relay` | 201 create, then the page, then a real Enter: signed, verified, relayed. The relayer answered 400 "supports pull", and the customer saw "The payment didn't go through. Nothing was charged." (that text comes from `relay.ts:70`, which runs only after `/relay` answers). The poll still said `open`. The live payment needs `paySale` on the relayer. |

## Speed (NFR-12, NFR-13). This is a Lighthouse-equivalent lab run, not Lighthouse
`perf.mjs` uses Playwright and CDP with Lighthouse's mobile profile:
- a 412×823 viewport at DPR 1.75 with a mobile UA;
- `Network.emulateNetworkConditions`: 150 ms latency, 1.6 Mbps down, 750 Kbps up;
- `Emulation.setCPUThrottlingRate` 4;
- a cold context for each run.

Two caveats:
- **The HTML wasn't delayed.** The navigation's `responseStart` reads about 2 ms, so devtools throttling didn't add the 150 ms latency to the HTML itself. The `DOC_DELAY_MS=600` runs hold the HTML back 600 ms to stand in for DNS, TCP and request round trips.
- **Server time is near zero.** Sessions live in memory here (p95 6.8 ms for the page). A Neon read on Vercel will add to it.

| Page (3 runs each) | FCP ms | LCP ms | TBT ms | CLS | INP proxy | JS (gzip) | Est. score |
|---|---|---|---|---|---|---|---|
| /checkout/<id> | 616–632 | 616–632 | 9–12 | 0 | 32 | 179,600 | 100 |
| /checkout/<id>, +600 ms HTML | 1,220–1,232 | 1,220–1,232 | 8–16 | 0 | 32 | 179,600 | 100 |
| /r/<unpaid id> (404 page) | 620–632 | 1,520–1,524 | 8–11 | 0 | n/a | 137,245 | 100 |
| /r/<unpaid id>, +600 ms HTML | 1,232–1,312 | **2,140–2,224** | 16–44 | 0 | n/a | 137,245 | n/a |
| / | 628–636 | 628–636 | 26–39 | 0 | 64 | ~395 KB before the tap | 100 |
| /merchant | 620–624 | 620–624 | 7–9 | 0 | 32 | 210,757 | 100 |

- **INP proxy.** The longest Event Timing entry for one tap on the first button. On /checkout that is a HoldButton tap, which cancels the hold and never confirms. On / the first button is "Try a checkout", so that tap navigated away.
- **Estimated score.** `lh-estimate.py` applies Lighthouse 12's mobile log-normal curves and weights. It takes Speed Index as equal to LCP, because Speed Index wasn't measured.
- **The /r rows are the 404 page.** I couldn't measure a paid receipt (see OPEN 4).
- **API timings (localhost, 20 requests each).** `POST /api/v1/sessions`: p95 1.0 ms. `GET /api/v1/sessions/:id`: p95 1.0 ms. This batch doesn't change the relayer.

## DONE
- **Builder's tests read and run** (the money path): `test/checkout-api.test.mjs` (23), `auth.test.mjs` (9) and `onchain.test.mjs` (4). All pass, and each money rule maps to a test that a mutant breaks.
- **New tests in `apps/web/test/checkout-edges.test.mjs`** (16; owned by the tester, and I left `contracts/src` and the product code alone). They cover:
  - the create limits;
  - pay 404 and 410;
  - malformed fields and the `validBefore` window, including the 465 s centre;
  - a wrong signer and another order;
  - the 409 `receiptId`;
  - a 5xx goes pending;
  - ENOTFOUND and EAI_AGAIN;
  - the 60 s margin, and a failed read never reopening;
  - polling an expired checkout;
  - per-wallet payments;
  - cookie flags and logout;
  - verify with another nonce or an oversized message.

  One of them is `todo`. It is RED on the current code and GREEN with the one-line fix in OPEN 1, which I checked in scratch: `fail 1` became `pass 16`.
- **Browser walks**, 375 and 1440, light and dark, in `round-1/shots/`:
  - home, and /merchant signed out;
  - /checkout ready, pending (two ways), paid, error and expired;
  - the 404 pages for /checkout and /r;
  - /merchant signed in, at 1440 and 375;
  - /proofs at 1440.

  No horizontal overflow (`scrollWidth` equals the viewport everywhere) and 0 CSP violations.
- **HoldButton probes**: on the real /checkout (`hold-checkout.json`, cases A–J), plus the four 002 probes re-run unchanged (`002-*.out`).

## OPEN
1. **A malformed signature crashes the pay route with a 500. It should be a 400.**
   - Where: `apps/web/app/api/v1/sessions/[id]/pay/route.ts:38`. Owner: claude-frontend. Severity: MEDIUM (validation at a trust boundary, and the spec says "a mismatch gives 400").
   - What happens: `verifyTypedData` throws on a bad v, on r = 0 or on a point off the curve. The route sends an empty 500, and the browser falls back to "The payment didn't go through. Nothing was charged." The relayer is never called, so no money is at risk.
   - Fix: `await verifyTypedData({...}).catch(() => false)`, the same pattern as `lib/auth.ts:72`. Then drop the `todo` option on the test "pay: a malformed 65-byte signature is a 400 mismatch, not a 500" in `test/checkout-edges.test.mjs`.
2. **The CSP isn't in force when /checkout is reached by client-side navigation.**
   - Where: `app/page.tsx:43-45` ("Try a checkout") and `app/merchant/page.tsx:77-81` ("Open a test checkout"). Both are server actions with `redirect()`, so Next swaps routes in place, and the document keeps the home or dashboard's no-CSP header. Owner: claude-frontend (reviewer-security owns the call). Severity: MEDIUM. It affects the demo entry points; a shop's real redirect is a full load and is covered.
   - Evidence: `probes/csp-softnav.out`: `checkoutAfterSoftNav {fetchOk: true, violations: 0, requestLeft: true}` against `checkoutAfterFullLoad {fetchOk: false, violations: 1, requestLeft: false}`.
   - Fix: make both buttons a full navigation. For example, a native `<form method="post" action="/api/demo-checkout">` to a route handler that answers 303 to `/checkout/<id>`, or `window.location.assign(url)` with the URL returned by the action.
3. **FR-REL-6: "gas spent today" isn't on the dashboard.**
   - Where: `app/merchant/page.tsx:112-129`. Owner: claude-frontend. Severity: LOW. The relayer returns null today, so the row would read "—".
   - Fix: add a `gasSpentToday` row next to "Budget left today".
4. **The receipt's LCP waits on a chain read and can pass 2.0 s. This is a risk; I couldn't measure it.**
   - Where: `app/r/[id]/page.tsx:12,45`. Owner: claude-frontend. Severity: MEDIUM-LOW.
   - Why: the whole receipt (amount, shop, time) streams only after `refundStatus()`, which can wait up to 1.5 s. FCP (0.62 s, or 1.23 s with the +600 ms HTML delay) plus 1.5 s gives 2.1–2.7 s when Ankr is slow, over the NFR-12 budget of 2.0 s.
   - Fix: render the receipt at once and stream only the refund line in its own `<Suspense>`.
   - Related (INFO): the 404 page paints its h2 about 0.9 s after FCP. With the +600 ms HTML delay that gives an LCP of 2.14–2.22 s for unknown ids.
5. **A captured sign-in can be replayed inside the nonce window.**
   - Where: `app/api/auth/verify/route.ts:2` says "The nonce is single use", but the server keeps no record of used nonces. Owner: claude-frontend; reviewer-security owns the severity. Severity: LOW.
   - Evidence: replaying the exact verify request (the same `mc_nonce` cookie, message and signature) after sign-out answered **200 and set a new `mc_session`** (`signin.json` `replaySameRequest`). This fits the spec's 5 min window. An attacker needs both the HttpOnly cookie and the signature, and the cookie is Secure on https.
   - Fix: either keep a used-nonce set (in memory now, Neon later) or reword the comment.
6. **Raw relayer balance.**
   - Where: `app/merchant/page.tsx:115` shows the relayer balance as `0.498377508835749934 WBT`, 18 decimals, which wraps at 375 px (`shots/merchant-signed-in-375-light.png`). Owner: claude-frontend (ux-ui's call). Severity: LOW.
   - Fix: round to about 4 decimals.
7. **Duplicate React keys.**
   - Where: `components/Checkout.tsx:131` uses `key={item.name}`, and the API accepts two items with the same name (for example two "Tea" lines with different prices), which gives duplicate keys. Owner: claude-frontend. Severity: LOW.
   - Fix: key by index.

## NEEDS THE USER
- **Lighthouse.** It isn't installed, and adding it is a new tool (PIPELINE §11). The numbers above come from a Lighthouse-equivalent lab run, and the perf ≥ 90 figure is an estimate, not a Lighthouse JSON. Install it (`npx lighthouse`) if the gate needs the real report.
- **Live consumer-rule test.** The permission classifier blocked `LIVE=1 node --test test/onchain.live.test.mjs` (read-only Ankr calls against the deployed MerchantPay). Allow it, or have ci run it. The builder reports it passed in 1.8 s.
- **Live AT-1.** The relayer needs `paySale` (claude-relayer), and the guest wallet needs test USDT. Until then, the paid and pending states, the paid receipt and the server-side pending on page load are covered only by unit tests and in-browser mocks.
- Carried from the spec's gate list (PIPELINE §11):
  - the public landing copy;
  - `'unsafe-inline'` scripts on the pay pages;
  - "Try a checkout" ends in "There isn't enough balance" for visitors once `paySale` is live;
  - the pending, chain-settled, `validBefore` + 60 s rule.
- **Real devices.** VoiceOver and TalkBack on the HoldButton, and a 900 ms touch hold on iOS and Android.
