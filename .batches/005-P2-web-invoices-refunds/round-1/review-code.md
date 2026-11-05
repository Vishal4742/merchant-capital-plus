VERDICT: PASS

# Code review: 005-P2-web-invoices-refunds, round 1 (reviewer-code)

Scope: `git diff -- apps/web` (20 modified files) plus the 12 new files, each read in full: the invoice pay route, `/pay/[invoiceId]` (page and not-found), `InvoicePay`, `Confirming`, `merchant/Invoices`, `merchant/Refund`, `lib/merchant-wallet.ts`, `lib/outcome.ts` and four test files. I also read the privacy edits (`app/tokens.css:1`, `docs/FRONTEND-PLAN.md`, the batch 002 build report). Inputs: spec.md, build-claude-frontend.md, batch.md, SRS (FR-PAY-1/2/3/7/8/9, FR-PRIV-1, NFR-12, AT-2), ARCHITECTURE §2–§3, my batch 004 round 2 review, the deployed source `~/ethglobal-contracts/contracts/src/MerchantPay.sol`, and the relayer's reject codes (`~/ethglobal-relayer/apps/relayer/src/relayer.ts`). I read no `.env` value, didn't run `npm run build`, and edited nothing in `apps/web`.

## Evidence
All runs used a new scratch copy, `scratchpad/rc005/`: apps/web synced without node_modules, `.next` or `.env*`, with node_modules symlinked. After the runs, `diff -rq` shows the copy identical to apps/web with no `.orig` files left, and `git status --short apps/web` still lists the same 32 entries.
- `npm test`: **125 tests, 123 pass, 0 fail, 2 skipped** (LIVE).
- `next typegen && tsc --noEmit`: exit 0. `eslint`: exit 0.
- **Live reads from `0xab81…4251`** (public RPC, no keys; script `scratchpad/rc005-probe/vec.mjs`):
  - `invoiceNonce(7, 25000000, 0x33…33)` = `0xf2300c68…58bb` and `saleNonce(0x11…11, 0x22…22, 25000000, 0x33…33)` = `0xae742da4…da8c`. Both equal the pinned vectors.
  - `relayFee` = 100000, `paused` = false, `invoiceCount` = 0, `paymentCount` = 7.
- **Live log-index probe through `lib/onchain.ts`** (`rc005-probe/logs.mjs`). This covers one of the build's "not verified" items:
  - `paidLogs` by payment id 1 returns one log with a tx hash, and its gross (5.00) matches `payments(1)`;
  - by merchant `0x37F9…42B1`, it returns payments 1–7 in ascending order (so `invoiceRows`' "last log wins" holds);
  - `merchantInvoices` returns 0 (none created yet);
  - so Blockscout's etherscan-style `getLogs`, with topic1/topic2 and `topic0_N_opr=and`, works on the real explorer.
- **USDT implementation** (Blockscout source of `0x2642…26F7`, TetherTokenV2 on OZ ERC20Upgradeable v4):
  - `approve` has no zero-first rule, so the exact-approval refund can't get stuck on a leftover allowance;
  - "insufficient allowance" and "exceeds balance" are reason strings, which `walletError` matches.
- **Mutation testing**, the full suite per mutant. Script `scratchpad/rc005-mut.sh` (same as rc004r2's). Sets: `rc005-mutants.tsv` (79 new), `rc005-extra.tsv` (8), and batch 004's three sets re-run. Logs: `rc005-new.log`, `rc005-n004.log`, `rc005-m004.log`.

## Why PASS
The money paths are correct, and their tests kill the mutants that matter. What's left is MEDIUM and LOW, which goes under FOLLOW-UP in fast mode (PIPELINE §3a).

**Phase 3 invoice rules**, checked against the deployed source:
- **Fee on top.** The customer signs `amount + relayFee()` (`pay.ts:65-66`), and the nonce covers the credited amount only (`pay.ts:49`). The relayer gets the credited amount (`route.ts:69`), and the fee is read on the server (`route.ts:46-50`). Mutants P4, P5, I19 and I20 are killed, and both vectors match the live views.
- **Partial payments.** The page and the route both charge `invoice.amount − invoice.paid`, which MerchantPay accepts even under 1 USDT when it clears the rest. The consumer rule checks that `paid` rose from the pre-relay read (`route.ts:84`). I1 and I12 are killed.
- **Paid only when fully paid.** The page and the route take the status from `invoices(id)`; nothing local sets "paid".
- **Invoice consumer rule** (`onchain.ts:129-137`): gross == amount + fee, the payer, the merchant, and `paid` rising by exactly `amount`, all read at the relay's block. O1–O4, O6 and O7 are killed.
- **Double charge.** The pay page always charges the full remainder, so a second attempt can only hit `InvoiceNotOpen` or `WrongAmount` on chain. The invoice `pending` state and the lock guard UX and gas, not money. The `InvoiceAttempt` comment (`sessions.ts:109-111`) says so correctly.
- **Refusals.** A 422 re-reads the invoice, so paid → the closed paid state and cancelled → 410 (I9 killed). A fee or invoice read failure gives 503 with nothing sent (I4 killed).

**Batch 004's rules survived the replay.** Every 004 mutant that still applies is still killed:
- compare-and-clear: N1–N3;
- first write wins: N5;
- replay is a refusal: N7, N8;
- the expiry ordering: N10, N10+11, plus my re-expressions N9b–d of the changed early-410 line;
- `consumeNonce`: N12–N15;
- poll and relay: N16–N18, N22, N27, N29;
- the round-1 set: M1–M48 that still apply, 40 of 40.

The remaining survivors are the ones accepted in 004:
- N6 is equivalent;
- X2, the early 410, is a fast path backed by `:51`;
- N23 is client phase order; the SSR probe from 004 covers it.

All five F5 mutants from 004 are now killed: N20, N21, N26, M26 and M45.

**The new shared code holds:**
- `parseApproval`: P1–P3, P7 and X4 are killed. P8 and P9 are equivalent, because `verifyTypedData(...).catch(() => false)` turns a bad signature or address into a 400 anyway.
- `relay()`: R1–R5 and the 004 relay mutants are killed.
- `outcome.ts`: U1–U6 are killed by the 11-row table.
- `Confirming`: markup only.

**The ABI matches ARCHITECTURE §2 and the deployed source:** `invoices(id)` field order, `payments(id)`, `relayFee()`, `createInvoice(address,uint128,uint64,bytes32)`, `cancelInvoice(uint256)`, `refund(uint256,uint256)`, the `InvoiceCreated` and `Paid` events, and the six error names.

**Next 16** (16.4.3, `cacheComponents`):
- `/pay/[invoiceId]` awaits params inside Suspense, before any `Date.now()` or chain read, like the checkout. The build shows it as ◐.
- `/merchant` calls `connection()` first.
- The route handler's context type passes typegen.
- `/pay/:path*` gets the pay-page CSP.
- `notFound()` inside the Suspense boundary renders the noindex not-found sheet with status 200 (per `node_modules/next/dist/docs/.../not-found.md`), the same as `/checkout`. Nothing depends on the status.

## Mutation survivors (new set: 64 of 79 killed)
| Mutant | Where | Verdict |
|---|---|---|
| W4: rethrow every error from the pre-approval simulation | `merchant-wallet.ts:101-103` | **Test gap on the AT-2 path** (F2) |
| X5, X6: drop the in-flight → pending prop on the checkout and pay pages; I18: drop the `invoice:` lock prefix (the page would never see it) | `checkout/[sessionId]/page.tsx:44`, `pay/[invoiceId]/page.tsx:51`, `route.ts:60` | No page tests (F4) |
| G2: constant salt in `signSale` | `sign-sale.ts:23` | Only `signInvoice`'s fresh salt is tested (F4) |
| O5: `paid ===` → `>=` | `onchain.ts:135` | No row where `paid` rose by more than `amount` (F4) |
| S2: no clock margin on the invoice pending state | `settle.ts:46` | UX only; MerchantPay refuses a second full payment (F4, optional) |
| W5: reverted receipt; W8: no log address filter; O11: no address check on the index logs | `merchant-wallet.ts:77,86`, `onchain.ts:151` | Backup guards (F4) |
| X7: refundable = gross, ignoring what was refunded | `merchant/page.tsx:105` | No page test; MerchantPay refuses with `RefundTooLarge`, shown as plain copy |
| I6, I7: the in-lock re-checks | `route.ts:64-66` | Backups for the pre-lock check; they differ only in a narrow race, and `InvoiceNotOpen` covers it. Keep, no test needed |
| S1, S4, W1 | boundaries and the cleanup write | Equivalent |

## FOLLOW-UP (owner claude-frontend unless noted; none blocks)
- **F1 (MEDIUM, NEEDS THE USER): FR-PAY-1's "customer" isn't captured.** FR-PAY-1 (M) is "create an invoice with customer, amount, due date and reference". The form (`Invoices.tsx:164-180`) has an amount, a due date and a private label. `merchant-wallet.ts:85` sends `zeroAddress` as the customer, and the build doesn't list this as a judgement call. On chain, the customer field is informational, and the payer is a fresh guest key, so an address is rarely known. Fix (smallest): call the field "Customer and reference (only you see it)", or add a private "Customer" field stored with the label. Pass a real `customer` address only if the human wants the AT-7 debtor on chain.
- **F2 (MEDIUM): the refund's approve-then-refund path isn't tested the way it behaves on chain.** When the allowance is short, the pre-approval simulation of `refund` always reverts on chain with USDT's "ERC20: insufficient allowance", and `merchant-wallet.ts:101-103` correctly swallows any non-MerchantPay error. But the fake wallet (`test/merchant-wallet.test.mjs:42-48`) answers "0x" for `refund` whatever the allowance. So W4 survives, and W4 would block every refund that needs an approval (AT-2, on the never-cut list). The builder's fork E2E ran the real path, so the code is right; the unit test just misses it. Fix: make the fake's `refund` eth_call revert with `Error("ERC20: insufficient allowance")` when `allowance < amount`. The short-allowance test then kills W4.
- **F3 (LOW): a pending invoice attempt that did land shows "paid" with no receipt.** `invoiceState` (`settle.ts:43-49`) clears the pending attempt once the status isn't open. `alreadyPaid` (`route.ts:24-27`) then has no payment id, and `InvoicePay.tsx:144` says "There's nothing left to pay." FR-PAY-9 wants a receipt. Sales recover the id through `saleOf`; invoices have no such getter, but `Paid` indexes the payer (topic3) and carries `invoiceId`. Fix when wanted: on the paid sheet, look up the Paid logs by `pending.from` and match `invoiceId`, keeping `invoiceState` synchronous. Also fix the comment at `relay.ts:75` ("the chain read finds the payment without it"), which is true for sales only.
- **F4 (LOW): one-line tests for the survivors above.**
  - X5, X6 and I18: move the two "in flight → pending" lines into a pure helper next to `invoiceState` and test it. The carried security F1 item names the page prop too.
  - G2: the same two-call fresh-salt test for `signSale`. This is 004's S2 rule.
  - O5: one `invoicePaid` row where `paid` rose by more than `amount` → false.
  - Optional: S2 (a pending attempt 30 s past validBefore is still pending) and W5 (a `status: "0x0"` receipt throws).
- **F5 (LOW): a stale invoice page can't recover.** If `relayFee` changes, or someone pays part of the invoice after the page loaded, every retry from that page gets 400 "This approval doesn't match the invoice" (`route.ts:55-58`). Fix: add "Reload this page and try again." to that message, or have the sheet reload on that 400.
- **F6 (LOW, Ponytail): duplication and dead code.**
  - `InvoicePay.tsx:60-100` repeats `Checkout.tsx:41-82` (signer warm-up, in-flight ref, the submit/outcome skeleton, `class Shown`). One `usePay(url, sign)` hook would keep that client money logic in one place, so a fix like 004's M1/M2 lands in both sheets.
  - The text of `outcome.ts:6-7` duplicates `relay.ts:31` and `:77`. `relay.ts` can import both strings from `outcome.ts`, which has no runtime dependencies.
  - Repeated across files: `STILL_PENDING` in both pay routes, `logged()` in the invoice route and the merchant page, and `/^[1-9]\d{0,19}$/` in four files.
  - Dead code: `InvoicePay` handles `terms === null` (`:32`, `:82`, `:159-163`), but the page always passes terms; when `payConfig()` is missing, it returns a Notice first (`pay/[invoiceId]/page.tsx:42`). Make `terms` required and delete the branch.
  - `paymentRefunded` (`onchain.ts:86-88`) has one caller left; use `readPayment(...).refunded`.
  - `invoiceRows` re-filters "missing" after `merchantInvoices` already dropped other merchants and empty invoices.
- **F7 (LOW): dashboard numbers and copy.**
  - "Sales, before fees" (`merchant/page.tsx:73,159`) adds invoice gross, which includes the customer's fee: a 10.00 invoice counts as 10.10. Use `gross − fee` for invoice rows (`Paid` has `fee`), or relabel the figure.
  - `merchant/page.tsx:170,260` and `Invoices.tsx:182` hard-code "0.10 USDT", but `relayFee` is an owner setting (≤ 0.25). The customer page already reads it live.
  - `merchant/page.tsx:187` renders "— USDT" when the value is null.
- **F8 (LOW): opening an invoice link from /merchant skips the pay-page CSP.** `Invoices.tsx:194` uses `next/link` for `/pay/<id>`, so the pay sheet runs inside the /merchant document, which has no CSP. This is 004's L5 in a new place. Customers arrive by a full page load, so only the merchant's own test payments are affected. Fix: a plain `<a href>`. The receipt link at `:228` is optional, because nothing on /r signs.
- **F9 (LOW): labels are keyed by invoice id only** (`Invoices.tsx:36`). MerchantPay was redeployed twice, and ids restart at 1, so labels saved against an earlier contract on the same origin attach to new invoices. Key them by contract: `mcplus.invoiceLabels.<merchantPay>`.
- **F10 (LOW): stale comments.**
  - `relay.ts:24,27-28` still say "checkout" and "OrderPaid"; they now cover invoices and `InvoiceNotOpen` too.
  - `relay.ts:75` is covered under F3.
  - `sessions.ts:72` says "for the session", but `claimPayment` also takes invoice keys.
  - `lib/sign-sale.ts` now signs invoices too; rename it only if that's cheap.
- **F11 (LOW, process): spec.md has no "files to touch" list** (PIPELINE §3.2). The files touched outside apps/web (`docs/FRONTEND-PLAN.md`, the batch 002 report) are the ones the privacy item names.

## Cross-lane (for claude-relayer and claude-research; not a frontend finding)
- **C1: the `payInvoice` relay body isn't defined anywhere yet.** The web sends `{action: "payInvoice", args: {invoiceId, from, amount (credited), validAfter, validBefore, salt}, sig}` (`relay.ts:44`). The function's own parameter is `id`. The relayer (RL2) must:
  - check the signature and the payer's balance against `amount + relayFee()`;
  - apply its 1 USDT minimum to the signed value, not to `amount`, because a final remainder may be under 1 USDT.

  Post this on agentbus, and have claude-research record it in ARCHITECTURE §3. Until RL2 lands, invoices can't be paid on the real chain (today's relayer answers 400 to anything but `pull`, which maps to "Nothing was charged").
- **C2:** ARCHITECTURE §2 "Rules: … relay fee 0.10 USDT taken inside the payment" is stale for invoices (fee on top since Phase 3).
- **C3:** ARCHITECTURE §1 names Blockscout `/api/v2/addresses/{a}/logs`. The code uses the etherscan-style `/api?module=logs&action=getLogs`, because it filters by topic. I verified it live (Evidence). A doc note.

## NEEDS THE USER
- F1: what "customer" means on an invoice (a private name, an on-chain address, or both).
- The private design-system link is gone from the working tree, but it's still in pushed history (e.g. `05ace3e`, `ebed59b`, `17a1695`). AGENTS.md forbids rewriting history. If the link must stay private, the human should stop sharing the artifact itself.
- Customer-page copy: the demo message says "test wallet" twice (judgement call 2; the human's gate decision, "Say it's a demo"). This is product copy, flagged only.
