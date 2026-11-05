VERDICT: PASS

# Test report: 004-P2-web-pages-and-sign-in, round 2 (tester)

All six round-1 failures and open items are fixed, and the round-2 changes hold in a real browser. In every reachable state the pay pages show no crypto words, make 0 requests to other origins and raise 0 CSP violations. /checkout ships 184,554 B of JS (limit 204,800). I added 2 tests that killed 2 surviving mutants, and every one of the 16 round-2 money mutants now dies. Nothing blocks the gate. What is left needs the human (Lighthouse itself) or can't be reached live (a paid receipt, a server-side pending page).

## Setup
- **Server.** `next start` on :3100, build `.next/BUILD_ID` at 00:57. `find app components lib next.config.ts test -newer .next/BUILD_ID` was empty when I started, so the build matches the source. I didn't rebuild or restart anything.
- **Secrets.** `SHOP_API_KEY` went into a shell variable only. `grep -c "$K"` on the API logs gives 0. The sign-in probes use a throwaway key made in memory.
- **Mutations.** Only in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/t004/web`, rsynced from apps/web (baseline there: 80 pass, 0 fail).
- **Not run** (as instructed): the live chain test and the Arkiv probe.
- **Probes and output** are in `round-2/probes/`: `walk.mjs`, `hold-checkout.mjs`, `demo-buttons.mjs`, `csp-softnav.mjs`, `signin.mjs`, `expired.mjs`, `perf.mjs`, `mutate2.py`, `chk.mjs`, `api-live.log`, plus their `.json` and `.out` files. Screenshots: `round-2/shots/` (the `*-ux2-*` files belong to the ux reviewer).

## Commands
| Check | Result |
|---|---|
| `npm test` (apps/web), builder's tree | `tests 81, pass 80, fail 0, skipped 1, todo 0` (the skip is the live test) |
| `npm test` with my 2 new tests | `tests 83, pass 82, fail 0, skipped 1, todo 0` |
| `npx tsc --noEmit` | exit 0 |
| `npm run lint` | exit 0 |
| `npm run build` | not run (it would replace the `.next` that :3100 serves); ci runs it |

## Round-1 items re-checked
| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | A malformed signature gives 400 | PASS | `api-live.log`: junk (`0x11`×65), all-zero and all-`ff` 65-byte signatures give `{"error":"This approval doesn't match the checkout. Nothing was charged."} [400]`, and the poll after still says `open`. Unit: "a malformed signature is a 400 mismatch, never a 500" and my test of the same name. Mutant R9 (no `.catch`) dies with 2 failures. |
| 2 | "Try a checkout" and "Open a test checkout" are full loads, and the CSP is in force | PASS | `demo-buttons.out`: both buttons give `POST /api/demo-checkout` 303 with no CSP, then a document `GET /checkout/<id>` 200 **with** the CSP header. `markerSurvived: false`, so it is a new document. The cross-origin `fetch` is blocked: `fetchOk false, violations 1, requestLeft false`, from both buttons. `csp-softnav.out`: `checkoutAfterSoftNav {violations 1, requestLeft false}`; round 1 gave `violations 0, requestLeft true`. |
| 3 | "Gas spent today" is on /merchant | PASS | `signin.json`: the signed-in text reads `Relayer balance 0.4984 WBT  Gas spent today —  Budget left today —  Fees not yet swapped — USDT  Status Running`. The "—" is the relayer returning null, as in round 1. Same at 375 and 1440. |
| 4 | The receipt card renders before the refund line | PASS (code only) | `app/r/[id]/page.tsx`: `Receipt` renders the card, and `RefundStatus` sits in its own `<Suspense fallback="Checking…">` inside the Refund `<dd>`. I can't measure it live: a paid receipt needs `paySale`, which the relayer refuses. See OPEN 1. |
| 5 | Sign-in replay inside the window gives 401 | PASS | `signin.json`: replaying the exact verify request after sign-out gives `{status: 401, setsSession: false}`. Without the cookie it is 401, and with a plain `mc_nonce` cookie it is 401. Mutants R6, R7 and R8 die. |
| 6 | The WBT balance has 4 decimals; no duplicate keys | PASS | `signin.json`: `Relayer balance 0.4984 WBT`, no horizontal overflow at 375 (`scrollWidth` 375). `Checkout.tsx:144` keys items by `${i}-${item.name}`, so two items with the same name no longer collide. The keys are checked by code, because a production build never warns about them. |

## Round-2 changes
| Change | Result | Evidence |
|---|---|---|
| "Confirming" panel | PASS | Reached by aborting the pay POST after it was sent, and by 504, 500 and 409 replies (`walk-*.json`, 4 schemes and widths). Each time: one `role="status"` panel, a "Confirming" pill, the copy "We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes.", 0 Hold buttons and 1 "Check again". The copy is ink (`rgb(23, 23, 33)` in light), not red. The pill is `rgb(154, 91, 0)` on white in light and `rgb(240, 180, 90)` on `rgb(28, 30, 43)` in dark. "Check again" is 108 × 44 px (`chk.mjs`). |
| "Check again" reloads | PASS | `checkout-confirming-checkagain`: 1 new document request, a `window.__marker` set before the click is gone (so a full reload), and the Hold button is back, because the aborted POST never reached the server. |
| Expired: no button | PASS | The natural case, with the checkout made at 01:00 and read at 01:31 (`expired.json`, 4 schemes and widths): the `alert` "This checkout has expired. Ask Bandra Beans for a new one.", 0 Hold buttons, 0 CSP violations, 0 other origins. The server agrees: `POST …/pay` gives `{"error":"This checkout has expired…"} [410]`, and the shop's poll says `expired` (`expired-pay.log`). A 410 reply to a live attempt also ends on "expired" with 0 buttons and 0 confirming panels (`checkout-expired-410route`). |
| Pending wins over expired | PASS (server by test and mutants; client by code) | Server: "an expired checkout whose last attempt is pending asks the chain first…" (409 pending, then 409 with the receipt id once the chain shows it paid). Mutant R4 (the early 410 ignoring `pending`) dies. Client: `Checkout.tsx:47`, `pending ? "confirming" : Date.now() > expiresAt ? "expired" : "ready"`. A pending session isn't reachable live (see OPEN 1), and the client has no test. |
| Branded not-found sheets | PASS | `/checkout/<unknown>`: h1 "This checkout link doesn't work", "Nothing was charged from this page.", a "Go to Merchant Capital+" link to `/` that is 44 px high. `/r/<unknown>` and `/r/<unpaid real id>`: h1 "No receipt here yet", the same link. 0 CSP violations, 0 other origins, no crypto words, no overflow, in all 4 schemes and widths. Both keep `noindex` in the head and body (`expired.json` robots). INFO: the HTTP status is still 200, as in round 1. |
| A fresh salt per attempt | PASS | `hold-checkout.json` F: two attempts in one tab give `posts 2, sameSalt false, sameFrom true`, and `validBefore − now = 465`. Round 1 gave `sameSalt true`. The body keys are still `from, salt, signature, validBefore`. |
| Replay is a refusal | PASS | Test "a 422 replay never locks the checkout…", and mutant R3 (replay turned back into unknown) dies. |

## Re-run in every reachable state
- **FR-PAY-7 / FR-PRIV-1 scan.** 4 walks (375 and 1440, light and dark) of ready, confirming × 4 (dropped, 504, 500, 409), check-again, expired (410 reply), paid, two attempts, error (a real attempt, light only), checkout-not-found, receipt-not-found and receipt-unpaid. Plus 4 natural-expired runs. **`cryptoWord: null` every time, 0 off-origin requests, 0 CSP violations, no horizontal overflow.** The only off-origin request in any walk is `/proofs`, which isn't a pay page.
- **Console.** Each non-200 pay reply or abort adds one "Failed to load resource" line, which I injected on purpose. There are no page errors, and no error on a normal load.
- **HoldButton probes on the real page** (`hold-checkout.json`):
  - a full hold gives 1 POST;
  - blur mid-hold gives 0 and a hidden tab gives 0;
  - a touch hold gives 1, 8 px of drift gives 1, 40 px gives 0;
  - Enter held 2 s gives 1;
  - a 200 leaves the receipt and no button; a 409 leaves "Confirming" and no Hold button;
  - the scene is drawn again after a hidden route is shown (`drawsWhileHidden 0`, `drawsAfterShow 88`, `contextLost false`).
  - **INFO, probe I.** "Pay in flight, go home, go back" used to stay busy (1 POST). "Try a checkout" is now a full load, so the page after "back" is a new document, the button is idle again, and a second Enter makes a second POST (`posts 2`). The server is the guard: one payment in flight per checkout (409, then the confirming panel), and the test "two payments at the same moment" with mutant M1 pins it. This is consistent with the design, so I'm not raising it.
- **NFR-12, lab run (Lighthouse's mobile profile; not Lighthouse).** 412×823 at DPR 1.75, a mobile UA, 150 ms and 1.6 Mbps, CPU ×4, a cold cache each run, 3 runs per row.

| Page | FCP ms | LCP ms | TBT ms | CLS | INP proxy ms | JS, gzip | Est. score |
|---|---|---|---|---|---|---|---|
| /checkout/<id> | 616–640 | 616–640 | 7–8 | 0 | 32 | **184,554** | 100 |
| /checkout/<id>, +600 ms HTML | 1,232–1,252 | 1,232–1,252 | 8–15 | 0 | 32 | 184,554 | 100 |
| /checkout/<unknown> (sheet) | 620–632 | 1,664–1,672 | 7–10 | 0 | n/a | 172,227 | 100 |
| /r/<unknown> (sheet) | 620–628 | 1,536–1,548 | 6–11 | 0 | n/a | 147,952 | 100 |
| /r/<unknown>, +600 ms HTML | 1,212–1,232 | **2,136–2,152** | 5–8 | 0 | n/a | 147,952 | 98 |
| / (no tap) | 632–636 | 632–636 | 35–64 | 0 | n/a | 395,078 before any tap | 100 |
| /merchant | 620–628 | 620–628 | 5 | 0 | 32 | 210,736 | 100 |

  - **/checkout JS is 184,554 B, up 4,954 B from 179,600 B in round 1. The limit is 204,800 B, so 20,246 B are left.** It is 12 files, and the signer chunk loads at idle after first paint.
  - **NFR-13.** On /, the three.js library chunk (`0qim1xdlnxjks.js`, 184,342 B) starts at 1,495–1,502 ms, against an FCP of 632–636 ms. There is no Nym request on / or /merchant. On /merchant, three.js starts at 2.17–2.18 s and there is no scene library.
  - **/merchant JS (210,736 B)** is the same as round 1 (210,757 B) and isn't a pay page. NFR-12's 200 KB budget names /checkout and /r only.
  - **/** isn't tapped any more. The first button is now a form post that leaves the page, so a tap would measure /checkout. The INP proxy for / therefore has no value this round. The LCP element is the `h1`.
  - **Estimated score** is the Lighthouse 12 mobile curves applied to the lab metrics, taking Speed Index as LCP. It is not a Lighthouse JSON.
  - **API timings** (localhost, 20 requests each, `api-timing.log`): `POST /api/v1/sessions` p95 1.1 ms; `GET /api/v1/sessions/:id` p95 0.7 ms. The relayer isn't part of this batch.

## Mutation run, in scratch only
`mutate2.py` applies each mutant, runs the whole suite and restores the file.
- **All 16 killed** (`mutants.log`):
  - R1: `clearPending` clearing a newer attempt
  - R2: `recordPayment` overwriting (last write wins)
  - R3: a 422 `replay` going back to pending
  - R4: an expired and pending checkout answering 410 before the chain
  - R5: the late 410 after settling removed
  - R6: `consumeNonce` never refusing a reuse
  - R7: `consumeNonce` remembering for 0 ms
  - R8: verify not consuming the nonce
  - R9: a malformed signature throwing
  - R10: the shop's poll ignoring in-flight
  - R11: the relayer's `txHash` format unchecked
  - R12: pending never reopening
  - R13: compare-and-clear skipped in `settle.ts`
  - R14: `settle.ts` returning "open" while a newer pending exists
  - R15: payer not checked in the consumer rule
  - R16: the session cookie expiry ignored
- **Two survived the builder's tests** (R5 and R11), and I added a test for each in `apps/web/test/checkout-edges.test.mjs`. Both then die:
  - "pay: an expired checkout whose pending attempt is dead (chain: not paid) answers 410 and relays nothing new"
  - "pay: a relayer 200 with a malformed txHash is an unknown outcome, never a recorded payment"
- **The round-1 set** (`mutate.py`, 25 mutants, `mutants-r1set.log`) re-run on the round-2 code: 24 killed. M6 ("replay mapped to unlock") says PATTERN NOT FOUND because that code is gone, and R3 covers it.

## Acceptance criteria and AT-* (changed since round 1)
| Criterion | Result | Evidence |
|---|---|---|
| Pay: a mismatch gives 400 and the relayer isn't called | PASS | `api-live.log` (3 junk signatures); the tests assert 0 relay calls. |
| Pay: pending on a 5xx, a timeout, a drop, an unconfirmed 200; 422 never pending | PASS | The tests, the browser walks (abort, 504, 500, 409) and mutants R3 and R4. |
| One payment in flight; a fresh salt per attempt (replaces "one salt per checkout") | PASS | M1 killed; `hold-checkout.json` F. |
| Checkout states: ready, expired, not live, error, confirming, paid | PASS (5 live, "not live" by code) | Shots below. "Not live" needs a server without `MERCHANT_PAY_ADDRESS`. |
| `/r/[id]` and unknown ids | PASS (not-found live; a paid receipt by code and unit only) | Shots below. |
| Home: "Try a checkout" creates a session and redirects | PASS | `demo-buttons.out`: 303 to `/checkout/<id>`. |
| `/merchant`: gate, signed in, sign out; replay refused; FR-REL-6 | PASS | `signin.json`. |
| Headers: XFO DENY, nosniff, Referrer-Policy everywhere; CSP on `/checkout` and `/r`; none on `/` and `/proofs` | PASS | `api-live.log`. The `/checkout/<unknown>` and `/r/<unknown>` documents carry the CSP too (`cspHeader: true` in the walks). |
| NFR-12 | PASS (lab run) | See the table above. |
| NFR-13 | PASS | See the table above. |
| AT-1 (partial: up to `/relay`, plus the shop's poll) | PASS up to `/relay`, as in round 1 | A real Enter on /checkout is signed, verified and relayed, and the relayer refuses `paySale` (error panel, button idle). The live AT-1 still needs `paySale` on the relayer and test USDT in the guest wallet. |

## Screenshots (`round-2/shots/`, 375 and 1440, light and dark)
- `checkout-confirming-{dropped,504,500,409,checkagain}-*`
- `checkout-expired-*` (the natural expiry) and `checkout-expired-410route-*`
- `checkout-notfound-*`
- `receipt-notfound-*`
- `receipt-unpaid-real-id-*`
- Also `checkout-ready-*`, `checkout-paid-*`, `checkout-two-attempts-*`, `checkout-error-real-{375,1440}-light`, `home-*`, `merchant-signed-out-*`, `merchant-signed-in-*` and `proofs-1440-*`.

I looked at the confirming panel (375 dark, 1440 light), the expired sheet (375 light) and the receipt not-found sheet (375 dark): all four read correctly, and the panel is clearly "pending", not an error.

## DONE
- All six round-1 items, and every round-2 change listed in the task, are verified as above.
- Two new tests in `apps/web/test/checkout-edges.test.mjs` (tester-owned). I changed no product code.

## OPEN
1. **A paid receipt and a server-side pending page can't be reached live.** The relayer refuses `paySale`, and guest wallets hold 0 USDT. So three things have code and unit evidence only: the receipt card rendering ahead of the refund line (round-1 item 4, `app/r/[id]/page.tsx`), the client's `pending → confirming` initial state, and "pending wins over expired" on the client (`Checkout.tsx:47`). Owner: claude-relayer for `paySale`; claude-frontend could add a render test of `Checkout` with `pending` and `expiresAt` in the past. Severity: LOW.
2. **/r/<unknown> LCP is 2.14 s with a 600 ms-late HTML.** It is an error sheet, not the receipt. Without the delay it is 1.54 s, and /checkout/<unknown> is 1.67 s. The sheet's body text paints about 0.9 s after FCP (LCP element `p.text-sm text-ink-muted`). Same as round 1's INFO. Owner: claude-frontend. Severity: INFO, no action needed for the gate.
3. **The `/checkout` and `/r` not-found pages answer HTTP 200**, because partial prerendering has already started streaming. They carry `noindex`. INFO.

## NEEDS THE USER
- **Lighthouse.** It still isn't installed, and adding it is a new tool (PIPELINE §11). The numbers above are a Lighthouse-equivalent lab run, and the score is an estimate.
- **The live consumer-rule test** wasn't run, as instructed. Allow it, or have ci run it.
- **Live AT-1.** It needs `paySale` on the relayer and test USDT in the guest wallet.
- **Real devices.** VoiceOver and TalkBack on the Hold button, and a 900 ms touch hold on iOS and Android.
- The spec's gate list, still the human's call: the public landing copy, `'unsafe-inline'` scripts on the pay pages, "Try a checkout" ending in "There isn't enough balance" once `paySale` is live, and the pending, chain-settled, `validBefore` + 60 s rule.
