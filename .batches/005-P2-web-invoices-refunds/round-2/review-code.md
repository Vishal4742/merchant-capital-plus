VERDICT: PASS

# Code review: 005-P2-web-invoices-refunds, round 2 (reviewer-code)

Scope: the round-2 delta (22 files, from `diff -rq` between my round-1 copy `scratchpad/rc005/` and apps/web) plus the full current text of both pay routes, both pay pages, `lib/onchain.ts`, `lib/settle.ts`, `lib/sessions.ts`, `lib/merchant-wallet.ts`, `merchant/page.tsx`, `merchant/Invoices.tsx` and `merchant/Refund.tsx`. Inputs: spec.md, build-claude-frontend.md (round 2), batch.md, my round-1 review, PIPELINE §3a, the deployed `MerchantPay.sol`, and the verified TetherTokenV2 source (implementation `0x2642…26F7` behind the USDT proxy `0xcedf…55a7`). I read no `.env` value, didn't run `npm run build`, and edited nothing in apps/web (`git status --short apps/web` lists the same 33 entries; no `.orig` files).

## Evidence
I made a new scratch copy, `scratchpad/rc005r2/`: apps/web without node_modules, `.next` or `.env*`, with node_modules symlinked. After every run, `diff -rq` against apps/web came back empty.
- `npm test`: **135 tests, 133 pass, 0 fail, 2 skipped** (LIVE).
- `next typegen && tsc --noEmit`: exit 0. `eslint`: exit 0.
- **Mutation testing**: the full suite runs once per mutant. Script: `rc005r2-mut.sh`, the same as round 1's.
  - Every earlier set re-run: `rc005r2-r1new.log`, `-r1extra.log`, `-n004.log`, `-n004x.log`, `-m004.log`.
  - A new round-2 set, Q1–Q34 (`rc005r2-mutants.tsv`, `rc005r2-q34.tsv`), logged in `rc005r2-q.log`.
- **Probe** for R2-F1 (a scratch test, since deleted): run against the copy with and without the one-token fix (details under R2-F1).
- **USDT order check**: TetherTokenV2's `transferFrom` is `onlyNotBlocked` and then OZ ERC20Upgradeable 4.4. That OZ version calls `_transfer` first ("ERC20: transfer amount exceeds balance") and checks the allowance after ("ERC20: transfer amount exceeds allowance"). So the builder's "balance before allowance" is correct. My round-1 note called the allowance string "insufficient allowance". That was wrong: that string belongs to OZ 4.5 and later, not this token.

## Round-1 findings
| # | State | Evidence |
|---|---|---|
| F1 customer | **Fixed**, per the human decision | A "Customer (only you see it)" field (`Invoices.tsx:197-200`) is stored with the label under `mcplus.invoiceNotes.<MerchantPay>`. On chain the customer stays `zeroAddress` (`merchant-wallet.ts:85`). |
| F2 refund fake | **Fixed** | The fake now reverts like MerchantPay over TetherTokenV2 (`merchant-wallet.test.mjs:52-56`). W4, re-expressed as Q18, is killed, and so are Q17, Q19 and Q32. One gap remains (R2-F2). |
| F3 landed invoice, no receipt | **Deferred**, accepted | LOW, with no money involved. The comment at `relay.ts:75-77` now tells the truth. |
| F4 survivor tests | **Fixed** | X5, X6 and I18 became `pageState` and `invoiceLock`, now tested (Q13–Q15 killed). G2, O5 and I6 are killed. S2 and W5 were optional and weren't added. Some page wiring is still untested (R2-F5). |
| F5 stale page | **Fixed** | The message now ends "Reload this page and try again." (`route.ts:62`), and a test checks it. |
| F6 Ponytail | **Partly deferred** | `usePay` was deferred with a reason. The other sub-items weren't touched and the report doesn't mention them: the dead `terms === null` branch (`InvoicePay.tsx:32,69,83`), `paymentRefunded` (`onchain.ts:87`, one caller), the duplicated `UNKNOWN`/`UNCONFIRMED` and `STILL_PENDING` strings, the `id` regex in 4 files, and `invoiceRows`' re-filter of missing invoices. All LOW; they carry forward. |
| F7 numbers and copy | **Fixed** | The fee comes from `relayFee()` on every merchant surface. The total is labelled "Paid by customers (invoice fees included)". The unswapped-fees row shows a bare "—". |
| F8 CSP | **Fixed** | The pay link is a plain `<a>` (`Invoices.tsx:223`), and `/merchant` now gets the pay-page CSP (`next.config.ts:40-42`). Nothing in the browser on /merchant fetches another origin, and wallet extensions aren't bound by the page's CSP. |
| F9 notes key | **Fixed** | `Invoices.tsx:55` |
| F10 comments | **Fixed** | Renaming `sign-sale.ts` was optional and was skipped. |
| F11 process | **Deferred** to claude-research | Accepted. |

## New round-2 code
- **`readUsdtBalance`** (`onchain.ts:97-99`) reads `balanceOf(owner)` on the USDT address. Q16 is killed.
  - The invoice route reads it in the same `Promise.all` as the invoice and the fee. The check sits after the signature check and before the lock (`route.ts:64`), and it compares against `amount + fee`, which is what USDT pulls.
  - The checkout route reads it after verifying, before `claimPayment` (`route.ts:38-39`).
  - Both routes treat a failed read as "carry on".
  - Q1–Q4 and Q6–Q8 are killed: the boundary is one unit short versus exactly enough, the fee is included, and the null guard holds.
- **`isShopInvoice`** (`settle.ts:53-55`) is applied in the route before the state and the relay, and on the page before rendering.
  - Q5 and Q10 are killed. Q12 (drop `status !== "missing"`) is equivalent: a missing invoice's merchant is zero.
  - Q11 survives because the case test can't fail (R2-F4).
  - The page's `settled === "missing"` line can no longer fire at run time. It stays because it narrows the type for `InvoicePay`.
- **`pageState` and `invoiceLock`** are correct. The checkout prop's new form differs from round 1 only for paid-and-in-flight, where `paid` wins anyway. Q13–Q15 are killed.
- **Refund form**: correct, and it closes tester R1 #2.
  - The form remounts on `${paymentId}:${left}` (`merchant/page.tsx:271`), and the open click resets the amount and the error.
  - An amount above what's left is refused in the client (`Refund.tsx:56`), and MerchantPay's `RefundTooLarge` is surfaced before any approval. A test covers the latter.
  - Close and Refund can't be clicked while busy, because `Button` drops `onClick` under `aria-disabled`.
- **Pre-approval dry run** (`merchant-wallet.ts:99-106`): correct for the deployed token, since the balance is checked first.
- **Two-step cancel** (`Invoices.tsx:256-313`): the hooks run before the early returns, both buttons are disabled while busy, and Cancel shows only when nothing is paid (MerchantPay refuses otherwise). A failure keeps the confirm open with plain copy.
- **Stacked cards**: the markup is sound. The 375 confirm-row crowding is ux N2. The code cause is the `inline-flex` group with no `flex-wrap`, inside the half-width grid cell (`Invoices.tsx:291`).
- **Scope**: every round-2 change traces to a round-1 finding or to a human decision in batch.md 02:33. Nothing outside the spec was built.
- **ABI**: unchanged from round 1. `balanceOf(address) view returns (uint256)` is the standard ERC-20 getter.

## Batch 004's money rules
They hold, with one ordering exception (R2-F1, message only).
- The round-1 sets re-run with the same results:
  - M-set: 40 of 40 applicable mutants killed.
  - N-set: everything applicable killed except N6 (equivalent) and N23 (client phase order; the SSR probe covers it).
  - N9b–d (the early 410) killed.
  - X1, X3, X4 killed. X2 survives, as accepted in round 1 (a fast path backed by the in-lock check).
- What each rule rests on:
  - Verify before relay: the balance check comes after `verifyTypedData` in both routes.
  - One in flight: the 400 returns before `claimPayment`, so it can't leak a lock. The tests' second call returns 200.
  - A 422 checks the chain: the relayer's `insufficient_funds` is still `refused` (Q21 killed).
  - Fresh salt: G2 killed.
  - First write wins: N5 killed.
- Survivors I accept: I7 (the in-lock re-read is a backup), X7, X8 (equivalent), P8, P9 (equivalent), S1, S2, S4, O11, W1, W5, W8 (backups and boundaries, as in round 1), and Q20 (allowance exactly equal to the amount would approve again: gas only).

## FOLLOW-UP (none is HIGH; owner claude-frontend)
- **R2-F1 (MEDIUM): a landed pending sale gets the demo message instead of its receipt.**
  - Where: `app/api/v1/sessions/[id]/pay/route.ts:38-39`. The balance check runs before `settlePending` (`:44`).
  - When it happens: a second tab still showing the button POSTs after the first tab's unknown-outcome attempt has landed and spent the guest's balance. The demo customer holds exactly 25 USDT (H1), so a 25.00 checkout drains it to zero. The page path is fine: a reload settles it on the server first.
  - What the customer sees: "This is a demo… doesn't have enough yet. Nothing was charged.", although they paid.
  - Probe: 400 NOT_FUNDED, `saleSettled` never called, payment not recorded. In round 1 the same request returned 409 "Already paid" with the receipt.
  - This bends 004's rule that an earlier attempt with an unknown outcome is settled by the chain before anything new happens. No money moves: after funding, a retry finds the payment.
  - Fix (checked in the copy: the probe returns 409 with the receipt id, and the suite stays at 133/133):
    ```ts
    if (balance !== null && balance < session.amount && !session.pending) return fail(400, NOT_FUNDED);
    ```
    Add the probe as a test: a pending session with `saleSettled → "1"` and balance 0 answers 409 with the receipt.
  - The invoice route is safe: `invoiceState` turns a pending attempt into 409, and a landed one into paid, before its balance check.
- **R2-F2 (LOW): the test fake's allowance revert string isn't the deployed token's.**
  - Where: `test/merchant-wallet.test.mjs:55` uses "ERC20: insufficient allowance". TetherTokenV2 says "ERC20: transfer amount exceeds allowance".
  - Why it matters: Q34, which loosens the pre-approval match to `includes("exceeds")`, survives. On chain, that mutant would block every refund that needs an approval (AT-2). The comment at `:28-30` says "USDT's own reason strings".
  - Fix: use the deployed string. The short-allowance test then kills Q34.
- **R2-F3 (LOW): the balance mocks ignore the owner.**
  - Where: `test/invoice-pay.test.mjs:38`, `test/checkout-api.test.mjs:25`.
  - Q29 and Q30 survive: `readUsdtBalance(pay.merchantPay)` instead of `(payer)`. On chain, MerchantPay holds about 0 USDT, so every payment would get the demo message.
  - Fix: record the argument in the mock, and assert it equals the body's `from` in the existing balance test.
- **R2-F4 (LOW): the case-insensitive test can't fail.**
  - Where: `test/invoice-pay.test.mjs:344`. `MERCHANT` is `0x1111…1111`, all digits, so `toUpperCase()` changes nothing and Q11 (exact compare) survives.
  - Fix: use a mixed-case address, such as the demo merchant `0x37F9…42B1` against its lowercase form.
- **R2-F5 (LOW, optional): lock wiring between the route and the pages.**
  - Q33 (`const lock = id` in the invoice route), Q22 and Q23 (the pages' lock key) survive. The helpers are tested; the call sites aren't.
  - Fix: one assertion inside an in-flight relay in `invoice-pay.test.mjs`, `pageState("open", invoiceLock(id)) === "pending"`. That kills Q33.
- **R2-F6 (LOW, optional): the dashboard's pure functions are untested.**
  - `confirmed`, `refundCell` and `paymentRows` (`merchant/page.tsx:58-120`) carry security F5's rule (other merchants' rows dropped, amounts from `payments(id)`) and the refund figure. Q25, Q31 and X7 survive.
  - Fix: move them to `lib/dashboard.ts` and add a 4-row test.
- **F6 leftovers (LOW)**: the round-1 table lists them. Delete the dead `terms === null` branch and `paymentRefunded` when the file is next touched.
- **Nit**: `balanceOf` now lives in `merchantPayAbi` (`onchain.ts:23`). That's fine for the `Read` type, but the name misleads. Rename it `readAbi` when the file is next touched.

## Cross-lane (unchanged from round 1)
C1 (the `payInvoice` relay body, and the 1 USDT minimum applied to the signed value), C2 and C3 still stand for claude-relayer and claude-research. Until RL2 lands, invoices can't be paid on the real chain.
