VERDICT: PASS

# Security review: 005-P2-web-invoices-refunds, round 2 (reviewer-security)

Fast mode (PIPELINE §3a): no HIGH or CRITICAL finding. Every round-1 follow-up I asked for in this round is in place and tested: F1, F2, F4, F5 (dashboard), F6 and F8. Both human decisions hold. Round 2 adds one MEDIUM regression (a stale second tab can be told "Nothing was charged" after a payment that landed) and one MEDIUM privacy item (the private design-system link id). Neither moves money. Both are under FOLLOW-UP, and the second also goes to the human.

## What was checked
- **Diff:** the 22 files that changed since round 1. I compared them with the round-1 code-review snapshot (`scratchpad/rc005`) and also read them against HEAD.
- **Tests** (`npm test` in a scratch copy identical to apps/web): **133 pass, 0 fail, 2 skipped (LIVE)**. The S5 race test passed 15 times out of 15.
- **Mutations** (scratch copy only, never apps/web): 19 run, 13 killed. Of the 6 survivors, 2 are equivalent and 4 are test gaps (F-N5, F-N6).
  - **Killed:**
    - invoice route: balance check deleted; fee dropped from the balance check; `<` changed to `<=`; a balance read failure made fatal; the shop check deleted; the S5 in-lock receipt check deleted;
    - checkout route: balance check deleted; a balance read failure made fatal; `<` changed to `<=`;
    - `isShopInvoice` made always true, or true when no shop is set;
    - the refund dry run's "exceeds balance" rethrow removed; the dry run swallowed entirely.
  - **Equivalent** (no security effect):
    - the balance check moved inside the lock: `balance` is already read, so it returns before any await and `finally` releases the lock;
    - the balance check moved ahead of the signature check: a balance is public chain data.
  - **Test gaps:**
    - the dashboard amount taken from the index (P1);
    - the dashboard merchant filter dropped (P2);
    - the `/pay` page shop check deleted (G1);
    - the refund check loosened to `includes("exceeds")` (F-N5).
- **Read-only calls on chain 1874** (no transactions):
  - `readUsdtBalance`, `readInvoice` and `readRelayFee` from `lib/onchain.ts` go out as one multicall (555 ms). Invoice 1 on 0xab81…4251 is the demo merchant's (0x37F9…42B1); relayFee is 100000.
  - `eth_call refund(1..3)` from the merchant, who has an allowance of 0, reverts with the reason **"ERC20: transfer amount exceeds allowance"**, passed up through MerchantPay's SafeERC20. So the F2 test (`includes("exceeds balance")`) can't match a missing allowance on the real token.
- **Real-extension check for F8:** I loaded a mock MV3 wallet extension, built the way MetaMask injects (a MAIN-world content script for `window.ethereum`, RPC calls in the background service worker, plus a web-accessible `chrome-extension://` script), in Playwright Chromium against the running :3100 server (production CSP header). Probe: `scratchpad/sec005r2/csp-wallet.mjs`.

## Round-1 follow-ups

### F1 (lock griefing): fixed for the free attack
- **Before the lock:** yes, in both routes.
  - Invoice: `app/api/v1/invoices/[id]/pay/route.ts:47-51` reads the balance in the same multicall as the invoice and fee, so all three come from the same block. `:64` refuses when `balance < amount + fee`, after the signature check (`:62`) and before `claimPayment` (`:66-67`).
  - Checkout: `app/api/v1/sessions/[id]/pay/route.ts:38-39` checks before `claimPayment` (`:41`).
  - Nothing is locked, relayed or marked pending (I1–I3 and C1–C3 killed).
- **A read failure falls through safely:** `.catch(() => null)`, then the request goes on to the lock and the relayer. This is the round-1 behaviour: no money can move without funds, and a relayer refusal is a 4xx that never sets pending. I4 and C2 are killed.
- **Does it close the griefing?** Yes, for throwaway keys. They hold 0 USDT, so they get 400 before the lock.
- **What's left:**
  - an attacker who holds `amount + fee` in an address the relayer refuses (an EIP-7702-delegated EOA, or a payer over the relayer's rate limit) can still take the lock again and again. That costs real capital per invoice size, and it only affects availability (LOW; per-IP limit and a code check still open);
  - the balance read gets no retry (F-N3).

### F2 (refund approval spent on low balance): fixed
- `lib/merchant-wallet.ts:102-104` rethrows "exceeds balance" before any `approve`. The test is `test/merchant-wallet.test.mjs:134`, and W1 is killed.
- TetherTokenV2 checks the balance before the allowance (round 1, live), and MerchantPay passes the reason up (above), so this matches the real chain.
- Residual: F-N5 (LOW).

### F4 (S5 race): fixed
`test/invoice-pay.test.mjs:359` kills the S5 mutant (I6), and it passed 15 of 15 runs. Request B reads "open", gets the lock after A has recorded its receipt, and answers 409 `paid:true` with one relay in total.

### F5 (index-only values): fixed on the dashboard, open on `/r`
- `app/merchant/page.tsx:73-79`: the row amount is `payments(id).gross`. A row whose chain merchant isn't the signed-in wallet is dropped, an index-only row whose record can't be read is dropped, and the Today total sums the confirmed rows (`:149`). Mutants P1 and P2 survive because the page has no test.
- `app/r/[id]/page.tsx:84-87`: the invoice number, time and tx link still come from Blockscout (LOW, carried).

### F6 (`name` on private inputs): fixed
- `components/merchant/Invoices.tsx:199,203`: the Customer and Label inputs have no `name`. They are read through refs (`:168`) and saved only to localStorage (`:81`).
- A submit before hydration can only put `amount` and `due` into the URL.

### F8 (CSP on /merchant): fixed; a real wallet extension still works
- `next.config.ts:42`; the header was confirmed on :3100 `/merchant`.
- With the mock MV3 wallet on a direct load of `/merchant`:
  - the MAIN-world provider is present;
  - `eth_chainId` returns `0x752` through the background;
  - the `chrome-extension://` script loads;
  - a page `fetch` to a third-party origin is blocked (`connect-src` violation).
- MetaMask and Rabby inject `inpage.js` into the MAIN world and make RPC calls from the extension, so page CSP doesn't bind them.
- The old MV2-style inline `<script>` injection was blocked by **MV3's own isolated-world CSP**, not by ours: the same thing happened on a page with no CSP.
- One gap: F-N4.

## Human decisions
- **/pay serves only MERCHANT_ADDRESS's invoices:**
  - **Route:** `route.ts:53` returns 404 before the state check, the lock and any relay, for another merchant's invoice and when no shop is configured (I5, H1 and H2 killed).
  - **Page:** `app/pay/[invoiceId]/page.tsx:49-50` calls `notFound()` before `invoiceState`, so a foreign id never touches attempt state. G1 survives because there is no page test.
  - Also: the sheet now always shows the shop's name, and `/merchant` shows invoices only for the shop wallet.
- **The private customer field stays in localStorage only:** confirmed.
  - It isn't in the server render (the server snapshot is `"{}"`), any `fetch` body, logs, the URL or the chain (`createInvoice(zeroAddress, …, random refHash)`, `lib/merchant-wallet.ts:84-85`).
  - A grep of every `fetch`, `sendBeacon` and `console.*` in `apps/web` turns up no note data.

## FOLLOW-UP (none blocks)

### F-N1 MEDIUM, regression: a stale second tab is told "Nothing was charged" after a payment that landed (owner: claude-frontend)
- **Where:** `app/api/v1/sessions/[id]/pay/route.ts:38-39`, which runs before `settlePending` (`:44`).
- **Sketch:**
  1. Tab A pays, and the outcome is unknown (timeout or 502), so the session goes pending. The sale did land, so the guest's 25.00 is gone.
  2. Tab B, opened earlier, still shows the hold button. Its POST reads balance 0 < 25.00 and answers 400: "This is a demo: … Nothing was charged."
  3. In round 1 the same POST reached `settlePending` and got the receipt.
  4. The same happens while A is in flight and already mined.
- **Proof:** a scratch test with `settled = "9"` and `balance = 0n` returns `400 {"error":"This is a demo: …Nothing was charged."}`. It should return 409 with the receipt. The existing test `checkout-api.test.mjs:263` misses this because the balance stays at 1,000 USDT.
- **Impact:** wrong money copy only. OrderPaid stops a second charge.
- **Not affected:** the invoice route. Its state check (`:54-55`) runs first, and its balance comes from the same block as the invoice status.
- **Fix:** skip the refusal when `session.pending || isInFlight(id)`, or move the check inside the lock after `settlePending` returns "open". Checkout ids are random UUIDs, so the griefing reason for checking before the lock doesn't apply to checkouts. Add the scratch test above.

### F-N2 MEDIUM, privacy (owner: claude-frontend; NEEDS THE USER)
- **Where:** `.batches/005-P2-web-invoices-refunds/round-1/test.md:18`.
- **Gap:**
  - That line contains the full 22-character id of the private design-system link. PIPELINE §3.7 commits batch markdown, so committing it would publish the id again.
  - The full link is also in **public** history on `origin/main` (`Vishal4742/whiteflow`, visibility PUBLIC): commits ebed59b, ed17ab7, 17a1695, c402929 and e06b7b4, and it stays in HEAD's `tokens.css` until this batch commits.
  - AGENTS.md forbids rewriting history.
- **Fix:**
  - claude-frontend redacts the id in test.md before committing.
  - The human decides whether to unshare or delete the artifact. That is the only fix that reaches history.

### F-N3 LOW: the balance guard turns off under RPC errors (owner: claude-frontend)
- **Where:** `lib/onchain.ts:97-99`. `readUsdtBalance` has no `retried`, while the invoice and fee reads retry once (`route.ts:48-49`).
- **Sketch:** a failed first multicall (Ankr 429 or a backend a block behind) gives a null balance, while the invoice read succeeds on retry. The request then takes the lock, which is the round-1 griefing for that request. A flood that rate-limits our server would trigger this, but such a flood hurts reads for everyone anyway.
- **Fix:** wrap it in `retried` and pass `{ tries: READ_TRIES }` like the others. Add the per-IP rate limit from round-1 F1 when Neon lands.

### F-N4 LOW: soft navigation into /merchant skips its CSP (owner: claude-frontend)
- **Where:** `app/page.tsx:23,42`. The two `<Link href="/merchant">` buttons on the home page, the main way in, do client navigation, and the dashboard then runs in the home document, which has no CSP.
- **Proof:** in Playwright, after home → "Open the dashboard", the third-party fetch was **not** blocked (`cspBlocksThirdPartyFetch: false`).
- **Impact:** low. Home loads nothing third-party today, so this is lost defence in depth.
- **Fix:** plain `<a href="/merchant">`, as round 2 already did for the pay link.
- **Side effect (functional, not security):** `/merchant` → `<Link href="/">` → home → `/proofs` runs `/proofs` under the pay-page CSP, which blocks the Nym CDNs.

### F-N5 LOW: the refund dry run still fails open on unfamiliar errors, and the fake's allowance string isn't USDT's (owner: claude-frontend)
- **Where:** `lib/merchant-wallet.ts:102-104` and `test/merchant-wallet.test.mjs:55`.
- **Gap:**
  1. Any dry-run error other than a MerchantPay error or "exceeds balance" still leads to an `approve`. Examples: a wallet that returns no revert data, or USDT upgraded to OZ v5 custom errors (`ERC20InsufficientBalance`).
  2. The fake reverts with "ERC20: insufficient allowance", but the real token says "ERC20: transfer amount exceeds allowance" (eth_call above). Loosening the check to `includes("exceeds")` passes all 9 tests and would stop every short-allowance refund on the real chain, which breaks AT-2.
- **Fix:** read `balanceOf(w.account)` before the approval instead of matching strings, and use USDT's real reason strings in the fake.

### F-N6 LOW: test gaps on two security-relevant page checks (owner: claude-frontend)
- **Gap:** mutants G1 (the `/pay` page shop gate) and P1/P2 (the dashboard amount and merchant filter) survive.
- **Fix:** move `confirmed()` and `paymentRows()` into `lib/` with a 3-row test, and add one test for the page gate. The route's gate, which is the money gate, is already covered.

### Carried, still open (LOW)
- **R1 F3:** the invoice consumer rule doesn't tie `paymentId` to the invoice. Deferred to RL2.
- **R1 F5:** the index-derived fields on `/r` (above).
- **Unknown-outcome window:**
  - An unknown invoice outcome keeps "Don't pay again" until `validBefore + 60 s`. `validBefore` comes from the browser and can be up to now + 900 s, so about 16 minutes.
  - A funded attacker who makes the relayer's transaction revert (by moving the funds out after the simulation) can repeat this, and the relayer pays gas for each revert.
  - Fix: use the 502's txHash (`lib/relay.ts:75-78`, already a `ponytail` note) and clear pending when its receipt shows a revert.

## Relayer (claude-relayer RL2)
Unchanged from round 1 (items 1–7). Also: our server now refuses unfunded payers before relaying, but it does **not** check for payer code. Item 11 of the relayer's drain guard (reject payers with code, including EIP-7702) is still the only guard against contract payers.

## Secrets grep (required)
Command: `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 45 changed or new files: the `git diff` and untracked files under `apps/web` and `docs/FRONTEND-PLAN.md`, plus the batch 005 folder without images. The `.env*` files were excluded and not read. Hits:
- `apps/web/test/auth.test.mjs:7,12,18-31,61-66,86,99-105,123` and `test/checkout-edges.test.mjs:12`: the fake `AUTH_SECRET` fixture and its variable name.
- `test/checkout-api.test.mjs:249,255` and `test/invoice-pay.test.mjs:107`: nonce vectors (public keccak outputs).
- `test/onchain.live.test.mjs:9`: the public smoke-sale tx hash.
- `round-1/shots/e2e-log.txt:3` (a tx hash) and `round-1/shots/ui-log.txt:5,6,10` (random refHashes and the test label "SECRETLABEL"): public or fixture values.
- `round-1/review-security.md:85-86`: my own grep notes.

No private keys, mnemonics or tokens. No `NEXT_PUBLIC_` variables in app code. The design link is gone from apps and docs, but see F-N2.

## NEEDS THE USER
- **F-N2:** the private design-system link is in public git history on origin/main (5 commits). Unsharing or deleting the artifact is the only fix that reaches history, since history can't be rewritten.
- Under PIPELINE §11 (money paths, user data), at the gate: `/pay` and its route now serve only `MERCHANT_ADDRESS`, so the deploy needs `MERCHANT_ADDRESS` **and** `SHOP_API_KEY` (≥ 24 characters). Without them every invoice is "not found" (fail closed).

## Files
- **Reviewed:**
  - `apps/web/app/api/v1/invoices/[id]/pay/route.ts`
  - `apps/web/app/api/v1/sessions/[id]/pay/route.ts`
  - `apps/web/app/pay/[invoiceId]/page.tsx`
  - `apps/web/app/checkout/[sessionId]/page.tsx`
  - `apps/web/app/merchant/page.tsx`
  - `apps/web/app/r/[id]/page.tsx`
  - `apps/web/app/page.tsx`
  - `apps/web/components/{InvoicePay,Checkout,Confirming}.tsx`
  - `apps/web/components/merchant/{Invoices,Refund,SignIn}.tsx`
  - `apps/web/lib/{onchain,pay,relay,settle,sessions,merchant-wallet,outcome,sign-sale,config}.ts`
  - `apps/web/next.config.ts`
  - `apps/web/test/{invoice-pay,checkout-api,merchant-wallet}.test.mjs`
  - `~/ethglobal-contracts/contracts/src/MerchantPay.sol:193-201`
- **Reviewer scratch** (not product code), in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/sec005r2/`:
  - `mut.py`: the mutation runner
  - `csp-wallet.mjs` and `ext/`: the mock MV3 wallet probe
  - `live-read.mjs` and `refund-call.mjs`: the read-only chain calls
  - `web/`: the scratch copy, the same as apps/web
