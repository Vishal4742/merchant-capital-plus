VERDICT: PASS

# Code review: 004-P2-web-pages-and-sign-in, round 2 (reviewer-code)

Scope: the round-2 changes to `apps/web`, found by diffing my round-1 snapshot (`scratchpad/rc004`) against the current tree, plus every new file read in full: `app/api/demo-checkout/route.ts`, `components/NotFoundSheet.tsx`, `app/checkout/[sessionId]/not-found.tsx`, `app/r/[id]/not-found.tsx` and `test/settle.test.mjs`. I also checked the removals: `app/actions.ts`, the per-checkout salt in `lib/sign-sale.ts` and the dashboard placeholders. Inputs: spec.md, build-claude-frontend.md (round-2 section), my round-1 review-code.md, and the relayer's reject codes (`~/ethglobal-relayer/apps/relayer/src/relayer.ts:80-254`). I read no `.env` value and didn't run `npm run build`. Nothing in `apps/web` was edited, and `git status` shows no stray files.

Evidence. Everything ran in a new scratch copy, `scratchpad/rc004r2/`, with node_modules symlinked:
- `npm test` (`node --experimental-test-module-mocks --test test/`): **83 tests, 82 pass, 0 fail, 1 skipped** (the live test). That count includes two tests the round-2 tester added to `test/checkout-edges.test.mjs` at 01:05, while I was reviewing. I synced that file into the copy and re-ran everything after it.
- `next typegen && tsc --noEmit`: exit 0. `eslint`: exit 0.
- Mutation testing, now against the **full suite** instead of one file per mutant: `scratchpad/rc004r2-mut.sh`, `rc004r2-mutants.tsv`, `rc004r2-extra.tsv`; logs in `rc004r2-r1set.log` and `rc004r2-r2set.log`.
- An SSR probe of the Checkout sheet's first paint: `scratchpad/rc004r2-checkout-ssr.mjs`. It transpiles the component with TypeScript and renders it with `react-dom/server`, imports stubbed.

## Why PASS
All four MEDIUM findings are closed, and each is pinned by a test that kills its mutant. The round-2 money changes are correct:
- settle's compare-and-clear;
- first-write-wins for `recordPayment`;
- a replay counts as a refusal, with the chain checked first;
- a pending attempt is handled before the expiry check;
- `consumeNonce`.

Each has a test that fails when the line is removed. What's left is LOW: test gaps on non-money guards, stale comments, and spec text that lags the code. Under fast mode (PIPELINE §3a) these go under FOLLOW-UP.

## Round-1 MEDIUM findings
| # | Status | Where | How I checked |
|---|---|---|---|
| M1 expired + pending | **Closed** | `pay/route.ts:24`: the early 410 now applies only when nothing is pending. `:51` re-checks expiry after `settlePending` returns `open`. `Checkout.tsx:47`: `confirming` is tested before `expired`. `:80-83`: a 410 now hides the button. | Mutants N9 (drop `&& !session.pending`) and N10 (drop the `:51` re-check) are killed, N10 by the tester's 01:05 test. In the SSR probe, `pending+expired` renders "Confirming" and "Check again" with no "has expired" and no hold button. Swapping the phase order (N23) flips it to "has expired", which the probe catches. |
| M2 false "Nothing was charged" | **Closed** | `Checkout.tsx:85`: a 409, or any 5xx other than 503, goes to `confirming`. A thrown fetch also goes to `confirming` (`:72-75`). A 503 or 4xx shows the server's own text. | Read the code. There's no unit test for the client (see F2). The SSR probe shows "Nothing was charged" in none of the five first-paint states. |
| M3 gas spent today | **Closed** | `merchant/page.tsx:104-107` adds the row. The relayer sends `null` today (`relayer.ts:251`), so it shows "—". | Read the code. The unit is still missing (F6). |
| M4 untested guards | **Closed** | The tester's `checkout-edges.test.mjs`, the builder's new tests, and the tester's two 01:05 tests | See the mutation table below. Every money-path guard from round 1 is now killed. |

## Round-1 LOW findings
| # | Handling |
|---|---|
| L1 `verifyTypedData` throws | **Fixed** at `pay/route.ts:41` (`.catch(() => false)`). N19 is killed by two tests. |
| L2 stale clear | **Fixed**: `clearPending(id, expected)` at `sessions.ts:105-107`, then `settle.ts:32-33` re-reads the session. N1, N2 and N3 are killed by `settle.test.mjs`. |
| L3 overwrite | **Fixed** at `sessions.ts:96-98` (first write wins). N5 is killed. |
| L4 a 422 whose chain read fails says "start again" | **Deferred with a reason**, which I accept: `OrderPaid` blocks a second charge on the same checkout. Only a new checkout from the shop could charge twice, and that needs a 422, a failed read and an earlier real payment all at once. The build note under S4 misquotes the copy, though. The code (`relay.ts:64`) still says "Nothing was charged; please start the checkout again", not "nothing charged by this attempt" (F1). |
| L5 soft navigation skips the CSP | **Fixed**: `app/actions.ts` is gone, and `/api/demo-checkout` answers a plain form POST with a 303. Nothing references `startDemoCheckout` any more. |
| L6 scope | **Fixed**: the Cash advance card, the "To investors" row and the "Refund soon" column are cut, and the header comment now cites FR-PAY-15 and FR-REL-6. |
| L7 shared ABI | **Deferred** (turbopack.root), but the comment at `onchain.ts:13` still says "once it's on main", and it is on main (F3). |
| L8 `relay.ts:67` stale ponytail comment | **Not addressed** and not mentioned in the build (F3). |
| L9 listeners pile up | **Fixed**: one AbortController per hold, aborted in `confirm`, `cancelHold` and on unmount (`HoldButton.tsx:39,51,67,83-86,96`). |
| L10 unbounded sessions | **Deferred** to the Neon batch. A `ponytail:` note is at `demo-checkout/route.ts:5`. |
| L11 `slice(1, 2)` key order | **Not addressed** (`checkout-api.test.mjs:306`) (F4). |
| L12 duplicate keys | **Fixed** (`Checkout.tsx:145`). |
| L13 `decodeURIComponent` throws | **Fixed** (`auth.ts:93-97`), but untested: N21 survives (F5). |
| L14 const between imports | **Not addressed** (`SignIn.tsx:11`) (F4). |

## Mutation results (full suite, synced copy)

**Round-1 set** (48 mutants). Of the 12 that survived in round 1, **9 are now caught**:
- M15 (validBefore window), M18 (a failed read reopens), M19 (`CLOCK_MARGIN_S` 0), M24 (max), M25 (20 items), M38 (salt length);
- M16: its regex now hits the post-settle 410 at `:51`, and the tester's 01:05 test kills it;
- M43: re-expressed as N18 because the status line changed; killed;
- M40: re-expressed as N16, N27 and N29 because the txHash check changed; all killed by the tester's 01:05 test.

**3 still survive:**
- **M26** (`qty > 999`): qty 1000 against amount 1.00 fails the add-up check first, so that check masks this one;
- **M39** (signature length): the `.catch(() => false)` now makes the length check redundant, so this mutant is equivalent;
- **M45** (future-dated nonce cookie).

M6 and M20 no longer apply as written; they are re-expressed as N7 and N4, both killed. Every mutant that was killed in round 1 and still applies is still killed.

**Round-2 set** (30 mutants): 21 killed, 9 survive.

| Area | Killed | Survived |
|---|---|---|
| Settle compare-and-clear | N1 (clear the current pending), N2 (clear unconditionally), N3 (always `open`), N4 (reopen without the validBefore margin) | none |
| recordPayment first write wins | N5 | N6: dropping `pending: undefined` from the record is equivalent, because `payment` wins every status check |
| Replay counts as a refusal | N7 (put replay back as unknown), N8 (drop `refused` from the 422) | none |
| Expired-pending ordering | N9, N10 (tester 01:05), N10+11 (both 410s removed) | N11 (just the early 410): `:51` backs it up, so it is only a fast path. Keep it. |
| consumeNonce | N12 (no `has` check), N13 (route skips consume), N14 (evict all), N15 (instant expiry) | none |
| Poll and relay | N16 and N27 (txHash format, `res.ok` → unknown), N17 (`isInFlight`), N18 (`expired` status), N22 (`isInFlight` returns false) | none |
| Checkout phases (client) | none in `npm test`; my SSR probe catches N23 | N23 (phase order), N24 (5xx → confirming), N25 (410 → expired) |
| Other | N19 | N20 (constant SIWE nonce), N21 (`cookieFrom` catch), N26 (303 → 307), N28 (= M26) |

The builder's own round-2 tests left N10, N16, N27 and N29 alive. The tester's two 01:05 tests kill them, and those tests are now part of `npm test`.

## New files and removals
- **`app/api/demo-checkout/route.ts`.** It ports `actions.ts` logic for logic. It answers 303, so the browser does a GET, and the plain `<form method="post">` on `/` (`page.tsx:39`) and `/merchant` (`merchant/page.tsx:75`) is a full page load, so the checkout gets its CSP. It doesn't parse the request body, so a cross-site POST can only create a demo session, which S6 already covers. No test pins the 303 (N26, F5).
- **`components/NotFoundSheet.tsx` and the two `not-found.tsx` files.** They reuse `StaticScene` and the sheet styles. The copy contains no "sign", "gas", "wallet" or "chain", so it passes the FR-PAY-7 scan. Each has a 44 px link home. `React.ReactNode` is used without an import, but it's a type-only use of the UMD global and tsc passes. `notFound()` still produces Next's noindex 404, so the spec line still holds.
- **`test/settle.test.mjs`.** Two tests that assert behaviour, not wiring. One injects a newer pending attempt during the chain read and checks both the return value (`pending`) and the stored `from`. The other checks first write wins. They kill N1, N2, N3 and N5.
- **Removed: the salt reuse in `lib/sign-sale.ts`.** `signSale(sale)` has one caller (`Checkout.tsx:68`), and nothing reads `sessionStorage` or `mcplus.salt` any more. Is it safe? Yes:
  - the salt reuse blocked a second charge only for the same authorizer;
  - `OrderPaid` (`saleOf(merchant, orderRef) != 0`) blocks a second payment for the order whoever pays, so it is the stronger guard;
  - a stranger can no longer pin the checkout through a burned nonce, because a 422 `replay` is a refusal;
  - our server never sends the same signed body twice: the claim, the pending state and the paid check stop it.
- **Removed: the dashboard placeholders.** They're gone, and nothing they used is left behind (the table now has 3 columns, with keys from the header text).
- **ABI and relayer contract.** Round 2 didn't change the `/relay` body or the chain reads (`lib/pay.ts`, `lib/onchain.ts` and `lib/usdt.ts` are byte-identical to round 1). The response mapping matches the relayer's current codes: `replay`, `expired`, `bad_signature` and the other 422s are refusals, `gas_price_cap` 503 is busy, and the `rpc_error`/`reverted`/`receipt_mismatch` 502s are unknown.

## FOLLOW-UP (owner claude-frontend for all; none blocks)
- **F1 (MEDIUM, before the human gate): spec.md lags the code on two money rules.**
  - `spec.md:36` still says "one salt per checkout (sessionStorage), so a retry reuses the on-chain nonce"; `:37` lists "a 422 `replay`" as pending; `:54` says "a server action". Round 2 deliberately changed all three, following security S2 and S3, and the code is safer for it.
  - The Files list (`:80-86`) is also missing `app/api/demo-checkout/route.ts`, `components/NotFoundSheet.tsx`, both `not-found.tsx` files, `test/settle.test.mjs` and `test/checkout-edges.test.mjs`.
  - Fix: amend those lines so the human approves the rule that was actually built, and correct the S4 line in build-claude-frontend.md to quote the real copy.
- **F2 (LOW): the Checkout response mapping has no automated check.** N24 and N25 survive `npm test`. Fix (smallest): move `Checkout.tsx:77-89` into an exported pure function, say `outcome(status, data)` returning `receipt | expired | confirming | error`, and add a 6-row `node:test` table: receiptId, 410, 409, 500/502/504, 503, 400. Otherwise the tester's browser probe of the confirming state is the only guard.
- **F3 (LOW): stale comments.**
  - `relay.ts:67` (L8): pending exists now and settle reads `saleOf`.
  - `onchain.ts:13` (L7): the shared file is on main; name the turbopack.root blocker instead.
  - `sessions.ts:33`: lists "replay" as pending.
  - `checkout-edges.test.mjs:131-132`: still says "todo until fixed".
- **F4 (LOW, carried): L11** (`checkout-api.test.mjs:306`: use `assert.equal(body.status, "paid")`) and **L14** (`SignIn.tsx:11`: move the const below the imports).
- **F5 (LOW): one-line tests for the guards that still survive.** Add them to `checkout-edges.test.mjs` or `auth.test.mjs`:
  - N20: two GET `/api/auth/nonce` calls return different 32-hex nonces;
  - N21: a cookie `mc_nonce=%E0%A4%A` gives verify a 401, not a 500;
  - N26: POST `/api/demo-checkout` gives 303 with Location `/checkout/<uuid>`;
  - M26: qty 1000 with amount "1000.00" gives 400;
  - M45: `readNonce(signNonce(n, s, Date.now() + 120_000), s)` gives null.
- **F6 (LOW):** "Gas spent today" and "Budget left today" have no unit (`merchant/page.tsx:106,110`). Add one when the relayer starts filling them; it sends null today.

## NEEDS THE USER
- F1 is a spec change on a money path (PIPELINE §11): a 422 `replay` is now a refusal, and each attempt gets a fresh salt, relying on on-chain `OrderPaid`. It sits next to gate item 4 (the unknown-outcome rule). Show the human the amended spec at the gate.
