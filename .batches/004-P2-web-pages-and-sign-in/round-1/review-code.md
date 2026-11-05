VERDICT: CHANGES

# Code review: 004-P2-web-pages-and-sign-in, round 1 (reviewer-code)

Scope: `git diff -- apps/web` plus every untracked file under `apps/web` (all read in full). Inputs: spec.md, build-claude-frontend.md, docs/SRS.md (FR-PAY-4/5/6/7/9/15, FR-REL-4/6, FR-PRIV-1, NFR-6/12/13, AT-1), ARCHITECTURE.md §2–§3, `~/ethglobal-contracts/contracts/src/MerchantPay.sol`, the relayer source (`~/ethglobal-relayer/apps/relayer/src/relayer.ts`) and my 002 round-3 review. No `.env` value was read, and I didn't run `npm run build`.

Evidence I produced (everything ran in a scratch copy, `scratchpad/rc004`, with node_modules symlinked; nothing in `apps/web` was edited):
- `npm test` baseline: 59 pass, 0 fail, 1 skipped (the live test).
- **48 mutants** of the money and auth paths: 37 killed, 11 survived (list below).
- **KIND_SALE vector, live:** the deployed MerchantPay `0x83b5…73b7` returns `KIND_SALE() = 2`, `KIND_INVOICE() = 1`, and `saleNonce(0x11…11, 0x22…22, 25000000, 0x33…33) = 0x6746adfa…16cc8`. That is the value the test pins. Our encoder gives the same value with kind 2 and `0x8e1288ae…0096` with kind 1, and the KIND_SALE = 1 mutant is killed.
- 002 probes re-run against the current components: `review-code-activity-remount` as built gives `drawsAfterShow 40, webgl2Lost false`, and `review-code-activity-hold` gives `shownAgain "Hold"`, with the second Enter confirming (`calls 2`). **D1a and D1b are fixed.**
- On the running `next start` (:3100): `/checkout/<id>` sends X-Frame-Options DENY plus the CSP, and `/` has no CSP. The prerender manifest lists `/`, `/merchant`, `/proofs` and `/_not-found` as prerendered, `/checkout/[sessionId]` and `/r/[id]` as dynamic, and no API route as prerendered.

## Why CHANGES
The core money logic is sound and well tested. Specifically:
- the server rebuilds and verifies the sale;
- one claim per checkout;
- unknown outcomes go pending;
- the consumer rule reads at the receipt's block;
- 422 checks the chain first;
- KIND_SALE matches the deployed contract.

Four MEDIUM findings remain. Two of them break the spec's own "no double charge, no false 'Nothing was charged'" criterion at the edges (M1, M2). One is an unmet acceptance criterion (M3). One is test gaps on money-path guards that mutation testing exposed (M4). Each fix is a few lines.

## MEDIUM (owner claude-frontend for all)

### M1. A pending checkout that passes its 30 min expiry tells the customer to get a new one
- `app/api/v1/sessions/[id]/pay/route.ts:22`: the 410 check runs before `settlePending`.
- Reproduced in scratch:
  1. pay, and the relayer times out (pending);
  2. `expiresAt` passes;
  3. the chain shows the order paid;
  4. the next pay gets **410 "This checkout has expired. Ask the shop for a new one."**, and `payment` is not recorded.
- `components/Checkout.tsx:147`: the `expired` branch comes before `stuck`. A reload of a pending checkout after expiry shows both "This checkout has expired. Ask Bandra Beans for a new one." and "Don't pay again".
- Reachable after any unknown outcome later than about minute 22: validBefore is +465 s, then +60 s of margin, so a pending checkout can outlive the 30 min.
- Why it matters: a new checkout has a new `orderRef`, so the contract's `OrderPaid` guard can't stop a second payment. This is the one double-charge path left.
- Fix:
  - In the route: `if (Date.now() > session.expiresAt && !session.pending) return fail(410, …)`, then inside the try, after `settlePending` returns `"open"`, re-check expiry and return 410.
  - In Checkout.tsx: test `stuck` before `expired` (for example `stuck ? null : expired ? … : sale ? … : …`).
  - On a 410 response, hide the button (`setExpired(true)`). Today it stays, and every press gets 410 again.

### M2. Checkout says "Nothing was charged" for any 5xx without a JSON body
- `components/Checkout.tsx:75-76`: only 504 and 409 set `stuck`. Any other status with no `error` field falls back to "The payment didn't go through. Nothing was charged."
- A 500 or 502 from our server or a proxy can come after the relay was sent. The spec says a dropped connection must never read "Nothing was charged", and a 5xx that isn't ours is the same unknown. This mirrors the rule `lib/relay.ts:69` already applies to the relayer.
- Fix: `if (res.status === 409 || (res.status >= 500 && res.status !== 503)) setStuck(true)`, and use `UNCONFIRMED` as the fallback text for those statuses. Today's reachability is low (localhost, and our route only throws before relaying; see L1). It matters as soon as anything sits in front of `next start`.

### M3. FR-REL-6: the dashboard doesn't show gas spent today
- `app/merchant/page.tsx:111-129` renders `wbt`, `budgetLeft`, `usdtFeesUnswapped` and `paused`. `health.gasSpentToday` is parsed (`lib/relay.ts:88`) but never shown.
- SRS FR-REL-6 and the spec's requirement line both list "gas today". The relayer sends the field (`relayer.ts:233`, null for now).
- Fix: one more `<div>` row, "Gas spent today", showing `{health.gasSpentToday ?? "—"} WBT`.

### M4. Money-path guards that no test checks (mutants that survived)

| Mutant | Code removed | Spec line it breaks |
|---|---|---|
| M15 | `pay/route.ts:33` validBefore window (now+30 s … now+15 min) | "validates … validBefore (now+30 s … now+15 min)". The upper bound is also what lets `settlePending` reopen a dead approval |
| M16 | `pay/route.ts:22` the 410 | "404 / 409 / 410 / 503" |
| M18 | `settle.ts:30` `paymentId === null &&` (a failed chain read past validBefore reopens the checkout) | "otherwise it stays pending" |
| M43 | `[id]/route.ts:20` the `expired` status | `status: open\|pending\|paid\|expired` |

- Fix: one table test. Cover 404, 410, `validBefore` = now+10 and now+901 (each 400 with `relayCalls.length === 0`), a pending checkout past validBefore whose read throws (stays 409 pending), and a poll of an expired session (`"expired"`).
- Add M1's case to the same test: pending, then expired, then paid on chain, gives a receipt rather than 410.

## LOW (defer or fold in; owner claude-frontend)

- **L1** `pay/route.ts:38`: `verifyTypedData` throws on a well-formed but invalid signature. With `0x00…00` (65 bytes) I got `Error: expected valid r: 1 <= n < …`, uncaught, so a 500 with a stack trace in the log. Nothing is relayed, so no money risk. Fix: `.catch(() => false)`, as `lib/auth.ts:72` already does.
- **L2** `lib/settle.ts:30-31`: the pending state is cleared based on a stale snapshot.
  - Reproduced: a slow poll held the old `pending` snapshot while a concurrent pay relayed again and set a new `pending`. The poll then cleared it, `status` read `"open"`, and attempt 2's outcome was lost.
  - A double charge is still blocked on-chain (`OrderPaid`, and the reused salt gives the same nonce), so this is LOW.
  - Fix in `lib/sessions.ts:99`: `clearPending(id, expected)` → `update(id, s => s.pending === expected ? { ...s, pending: undefined } : s)`. Immutability makes the identity check free.
- **L3** `lib/sessions.ts:91-93`: `recordPayment` overwrites. A concurrent `findPayment` can replace the pay route's record, which has the txHash, with `txHash: null`, and the receipt loses its explorer link. Fix: first write wins, `update(id, s => s.payment ? s : { …, payment, pending: undefined })`.
- **L4** `pay/route.ts:52`: on a 422, if the chain read fails (`findPayment` → `undefined`), the customer is told "start the checkout again". That is the same ambiguity the spec settles with "check the chain first". Consider `markPending` when the read is `undefined`.
- **L5** `app/page.tsx:37-39`, `app/merchant/page.tsx:77`, `app/actions.ts:25`: the "Try a checkout" server action redirects with a client-side navigation once the page is hydrated. The pay page then runs inside the home page's document, which has no CSP, so the `/checkout` CSP only protects hard loads (a shop's redirect, a reload).
  - No third-party script loads on `/` today, so the risk is small, but the spec's CSP check only means something on a hard load.
  - Option (native platform rung): a plain `<form method="post" action="/api/demo-checkout">` route that answers 303, which is a hard navigation. The security reviewer owns the call.
- **L6 Scope** `app/merchant/page.tsx`: none of these trace to the spec's /merchant criterion. Delete them or cite them:
  - the "Cash advance" card (`:85-90`, FR-ADV is Phase 3);
  - the "To investors 0.00" row (`:102-105`);
  - the "Refund soon" column (`:146-150`, `:170-172`, FR-PAY-8 is out of scope);
  - the header comment (`:1-3`), which still cites "FR-PAY-8 view, FR-INV-2 pricing" after the pricer was cut.
- **L7 Ponytail rung 2.** `packages/shared/merchantPay.ts` is on main (099bb97 is an ancestor of HEAD), so the trigger in the spec and in `lib/onchain.ts:13` has fired.
  - `lib/pay.ts:10`, `lib/usdt.ts:5-21` and `lib/onchain.ts:14-17` copy `KIND_SALE`, `usdtDomain`, `receiveWithAuthorizationTypes` and the ABI.
  - Importing the shared file needs `turbopack.root` set to the repo root (apps/web has its own lockfile). Do it with batch 005, or now; the vector test guards the copy until then.
- **L8** `lib/relay.ts:68`: the `ponytail:` comment says "poll it … once payments have a pending state". They have one now, and `settlePending` reads `saleOf`, so the 502's txHash isn't needed. Update the comment.
- **L9** `components/HoldButton.tsx:79-80`: the `{ once: true }` blur and visibilitychange listeners are only removed when they fire, so each completed or cancelled hold leaves two behind. They are harmless (the phase guard), but they pile up. Fix: an `AbortController` in a ref, aborted in `cancelHold` and `confirm`.
- **L10** `lib/sessions.ts:39-40` + `app/actions.ts`: the public server action creates sessions with no limit, and nothing is ever evicted. Under the localhost-only constraint, add `ponytail:` to the existing comment ("unbounded; Neon + TTL delete").
- **L11** `test/checkout-api.test.mjs:301`: `Object.values(…).slice(1, 2)` depends on key order. Use `assert.equal(body.status, "paid")`.
- **L12** `components/Checkout.tsx:131`: `key={item.name}` repeats when a shop sends two lines with the same name. Use the index.
- **L13** `lib/auth.ts:80`: `decodeURIComponent` throws on a malformed cookie, so the verify route returns 500. Wrap it and return `undefined`.
- **L14** `components/merchant/SignIn.tsx:11-12`: a `const` sits between imports. Move it below them.

## Mutation results (scratch copy; `scratchpad/rc004-mutants.tsv`, `rc004-mut.sh`)
Killed (37):
- KIND_SALE; the consumer-rule payer, gross and merchant checks; the zero id; same-block retry and the retry count.
- replay, 429, NOT_SENT, a dropped socket, 5xx, insufficient_funds.
- verifyTypedData, `claimPayment` and the in-flight set; the 422 chain check; the consumer rule after a 200; `markPending`; settling before relaying; the paid and pending returns; `findPayment` recording; poll settling.
- items adding up, the minimum, the Bearer check.
- the nonce HMAC and its age; the required and maximum SIWE expiry; chain id; session expiry; clearing the nonce.

Survived (11):
- M15, M16, M18, M43 (see M4).
- M19 (`CLOCK_MARGIN_S` 0).
- M24, M25, M26: the 10,000 maximum, the 20-item limit and qty ≤ 999.
- M38, M39: salt and signature length. The salt check does matter: without it, a short salt makes `encodeAbiParameters` throw a 500.
- M40: a 200 with no txHash counts as ok. The consumer rule still guards it.
- M45: the nonce cookie's future-date check.

Only M15, M16, M18 and M43 need tests this round. The others are boundary checks; add them to the same table test if it's cheap.

## Checks requested
- **Next 16.**
  - Both dynamic pages pass the `params` promise into a child inside `<Suspense>` and await it there (`checkout/[sessionId]/page.tsx:19,26`, `r/[id]/page.tsx:34,41`). Correct for `cacheComponents`.
  - `/merchant` calls `await connection()` before `Date.now()` and before the env-dependent early return, which runs before `cookies()`. It's needed: with no `AUTH_SECRET`, `cookies()` is never reached.
  - Route handlers use `(request: Request, { params }: { params: Promise<{ id: string }> })`, which is valid. `RouteContext<'/api/v1/sessions/[id]'>` is the typed helper, but that's optional.
  - GET `/api/auth/nonce` and GET `/api/v1/sessions/:id` read `request.url` and `request.headers`, so they run at request time (not prerendered, as the manifest confirms).
  - `notFound()` inside Suspense gives 200 + `noindex`, as the build report says.
- **KIND_SALE / consumer rule vs MerchantPay.sol.**
  - `saleNonce` encodes `uint256(uint160(merchant))`. viem's `address` type gives the same 32-byte word, so the encodings match (live vector above).
  - `paySale` reverts `OrderPaid` when `saleOf != 0` (`:161`).
  - `payments` returns `(merchant, uint96 gross, payer, uint96 refunded)`, which matches `lib/onchain.ts:16`.
  - The rule's checks (gross == amount, payer == signer, merchant) match ARCHITECTURE §2 and S6 a.
  - The relayer's codes (`replay`, `insufficient_funds`, `would_revert`, 502 `rpc_error`) and `/health` field names match `lib/relay.ts`.
- **Immutability in `lib/sessions.ts`.** It holds:
  - `createSession` builds a new object, and every write goes through `update`, which spreads a copy;
  - callers re-read after settling (`getSession(id) ?? found`);
  - a grep for in-place writes to session or payment objects in `app/`, `lib/` and `components/` finds none, only local array builders.
  - The one exception is in the tests: `checkout-api.test.mjs:258` writes into the stored object. Passing `now` to `settlePending` instead is cleaner, but it's optional.
- **Error handling.** Server reads log once and degrade to pending or "Couldn't check right now", and relayer text never reaches the customer. The gaps are L1, L13 and M2.
- **Ponytail.** No new dependency, no auth library, and `viem/siwe` and `node:crypto` are used. `StaticScene` is reused by DitherScene, and `usdtDomain`/`receiveTypes` are shared with guest-wallet. Over-build: L6. Duplication: L7.

## Carried from 002 round 3 (files touched here)
| Item | Now |
|---|---|
| D1a `forceContextLoss` | **Fixed** (`DitherScene.tsx:170-172`; probe: 40 draws after the route is shown again) |
| D1b HoldButton stuck on "Done" | **Fixed** (`HoldButton.tsx:46-55`, the one-line fix as proposed; probe: Hold, then calls 2) |
| #17 touch slop | **Fixed** (`SLOP_PX = 12`, `:19`, `:86`) |
| #7 `buttonClasses` / `aria-describedby` | Resolved: both now have callers (`app/page.tsx`, `merchant/page.tsx`, `Checkout.tsx:153`). `HOLD_MS`/`DONE_MS` are still exported with no outside caller (LOW) |
| #6b redundant guard | Open. It moved to `app/proofs/page.tsx:145` with the old home |
| #12b fallback paths | Open: `DitherScene.tsx:66-72` (resize not debounced) and `:175-178` (draws once, no resize). `StaticScene` now has the debounced redraw, so reuse it there |
| #13 thresholds duplicated, #15 dither test | Open, unchanged |
| INFO: stale `onConfirm` | Covered for the pay page: a label change (which follows the amount) cancels the hold, and `Checkout` reads `sale` when it is called |

## Process note
My mistake, no product impact: while setting up, I rsynced `apps/web` into the shared scratchpad's existing `web/` folder before I noticed it was the builder's scratch copy. That overwrote its source files with the repo versions and deleted its `out.txt` and `vals.txt`. A stray `apps/web/.vector-probe.mjs` copy existed for a few seconds and was removed; `git status` shows no trace of it. My own work then moved to `scratchpad/rc004`.

## NEEDS THE USER
Nothing new from code review. The spec already lists the four gate items: landing copy, `'unsafe-inline'`, the zero-balance demo, and the pending rule. L5 (CSP on a soft navigation) sits next to item 2 if the security reviewer raises it.
