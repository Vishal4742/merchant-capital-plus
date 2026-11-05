VERDICT: PASS

# Security review: 005-P2-web-invoices-refunds, round 1 (reviewer-security)

Fast mode (PIPELINE §3a): no HIGH or CRITICAL finding. The three new money paths (customer invoice payment, merchant refund, merchant invoice create and cancel) hold against the deployed final MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251`. The MEDIUM and LOW items are under FOLLOW-UP. The relayer items (RL2) go to claude-relayer.

## Scope and what was checked
- Diff: `git diff -- apps/web` (20 files) plus 13 new files (invoice pay route, `/pay/[invoiceId]`, `InvoicePay`, `Confirming`, `merchant/{Invoices,Refund}`, `lib/{merchant-wallet,outcome}.ts`, 4 test files). Contract: `~/ethglobal-contracts/contracts/src/MerchantPay.sol` @ 8c77e59.
- `npm test` in apps/web: **123 pass, 0 fail, 2 skipped (LIVE)**.
- **Read-only eth_call on 1874** against 0xab81…4251:
  - relayFee 100000
  - feeRecipient 0xdd02…a651
  - paused false
  - market 0xEcd6…0ABE
  - invoiceCount 0, paymentCount 7
  - `invoiceNonce(7, 25000000, 0x33…33)` = `0xf2300c68…58bb`, which equals the vector in `test/invoice-pay.test.mjs:89`.
- **Local anvil fork** of 1874 (port 8645, the deployed bytecode, no real transactions; the fork is stopped). The test signs with the web's own `lib/pay.ts invoiceAuthorization` and reads with `lib/onchain.ts`:
  - a signature without the fee (`value = amount`) reverts in `payInvoice`;
  - our signature relayed with a smaller credited amount (5.00 instead of 10.00) reverts, because the nonce binds the credited amount;
  - the real signature: the guest was charged exactly **10,100,000 units (10.00 + 0.10)**, gas 185,541, the invoice turned Paid, and `invoicePaid()` (the consumer rule) returned true at the receipt's block;
  - refund of 4.00 after `approve(MerchantPay, 4.00)`: `Refunded(8, 4e6, 4e6)`, Transfer merchant → payer, and **allowance back to 0**;
  - `refund(8, 1)` from another address reverts `NotMerchant()` (0x3b6405f4).
- **USDT implementation** (TetherTokenV2 `0x2642…26f7`, verified source on Blockscout):
  - `approve` is plain OZ (a non-zero → non-zero change is allowed);
  - `transferFrom` runs `_transfer` (the balance check) **before** the allowance check. This is confirmed live: `transferFrom(dead, x, 1)` called as MerchantPay reverts "ERC20: transfer amount exceeds balance". This matters for F2.
- **viem 2.57.13:**
  - `sendTransaction` asserts the current chain for json-rpc accounts (`assertChainId = true`), so chain 1874 is enforced at every merchant send;
  - `verifyTypedData` recovers ECDSA only, so a contract payer can't pass the server check.
- **Mutations** (scratch copy of apps/web, never apps/web): 18 run, 17 killed, 1 survived (S5, below). The killed ones:
  - the credited amount ignoring `paid`;
  - each consumer-rule clause dropped (gross, merchant, paid-rose);
  - the lock removed;
  - an infinite approval;
  - the pre-approval simulation swallowed;
  - the signed-in wallet check removed; the chain switch removed;
  - a constant refHash;
  - a nonce over amount + fee;
  - pending kept after the chain says paid;
  - a 422 without the chain check; unknown not pending;
  - the R2 F1 regression;
  - the paidLogs merchant filter removed; the merchantInvoices on-chain filter removed.

## Answers to the focus questions
- **Can the browser make the server relay a different amount, fee, invoice or merchant?** No.
  - The browser sends only `from, salt, validBefore, signature`. `parseApproval` checks their shape and the relayer window.
  - The server rebuilds the typed data itself (`route.ts:55-57`):
    - the invoice id comes from the path;
    - the credited amount is `invoices(id).amount − paid`, read on chain;
    - the fee is `relayFee()`, read on chain;
    - `to` is the configured MerchantPay and `validAfter` is 0.
  - The relay args are built from the same `terms` (`route.ts:69`). The merchant is never an input: MerchantPay takes it from `invoices(id)`.
  - The nonce binds chain, MerchantPay, KIND_INVOICE, id and amount. The fee is bound through `value`. The typehash is ReceiveWithAuthorization (`to == msg.sender`), so `transferWithAuthorization` can't use the signature (fork-verified above).
- **Consumer rule and the race with a concurrent partial payment.** The rule is sound.
  - `onchain.ts:135` requires all of: gross == amount + fee, payer == the signer, merchant == the invoice's merchant, and `paid == paidBefore + amount`, read at the relay's block.
  - The page always pays the full rest. So a partial payment that lands first makes ours revert `WrongAmount`, which arrives as a 422 with no money moved. A payment after ours reverts `InvoiceNotOpen`.
  - A stale (lagging) pre-read can only make our attempt revert, never pay twice. Because every attempt pays the full rest, MerchantPay itself prevents a double charge, even after a restart loses `pending`.
  - Gap: the rule doesn't tie `paymentId` to this invoice (F3, LOW).
- **Pending, settle and 422.**
  - Unknown outcomes stay pending until validBefore + 60 s (USDT enforces validBefore, so the attempt is dead after that).
  - A chain status other than open ends pending.
  - A 422 re-reads the invoice: paid becomes 409 `paid:true`, cancelled becomes 410, still open becomes 400 "Nothing was charged; please try again".
  - Every "Nothing was charged" message is on a path where nothing was sent: a read failure, a mismatch, a relayer 4xx/422/429/503 or ECONNREFUSED.
- **Refund.**
  - It approves exactly `amount` only when the allowance is short (S7 killed), and the allowance returns to 0 (fork).
  - MerchantPay errors are shown before any approval (S8 killed).
  - Exception: a short USDT balance still spends an approval (F2).
  - A leftover allowance is only spendable by the merchant itself: MerchantPay's only `transferFrom` is `refund`, from `msg.sender`.
- **refHash and private data.** `refHash = keccak256(32 random bytes)` and the customer is the zero address (`merchant-wallet.ts:84-85`), so no label or PII goes on chain. The label stays in localStorage, except for a pre-hydration edge (F6).
- **Signed-in wallet == sender; chain 1874.**
  - `connectMerchant` (`merchant-wallet.ts:56-57`) requires the wallet's account to be the SIWE merchant, and every send uses `account: w.account`.
  - viem asserts chain 1874 at each send. MerchantPay enforces `NotMerchant` for refund and cancel.
- **Merged payments table: can one merchant see or refund another's payments?** No.
  - Sessions are filtered by merchant (`sessions.ts:63`).
  - Paid logs are filtered by topic2 and the decoded merchant (S17 killed).
  - Invoices are filtered by the on-chain merchant (S18 killed).
  - The Refund button appears only when `payments(id).merchant` == the signed-in merchant (`merchant/page.tsx:104`), and the contract checks it again.
  - Gap: index-only display values are trusted (F5, LOW).
- **`/r/<paymentId>`.**
  - Every value is rendered as React text. The tx hash passes `isHash`; ids must match `^[1-9]\d{0,19}$`.
  - The merchant name is shown only when the payment is ours; the payer address is never shown.
  - Everything shown is public chain data. Sequential ids make receipts enumerable, but they reveal no more than the explorer does.
- **CSP.** `/pay/:path*` gets the pay-page CSP (`next.config.ts:38`): `connect-src 'self'`, no third-party origins. In app code, other origins appear only as the explorer links and server-side reads (Ankr, Blockscout).

## Secrets grep (required)
Command: `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 33 changed or new files in apps/web (the `.env*` files were excluded and not read). Hits:
- `test/auth.test.mjs:7,12,18-31,61-66,86,99-105,123` and `test/checkout-edges.test.mjs:12`: the fake `AUTH_SECRET` test fixture and its variable name. Not a real secret.
- `test/checkout-api.test.mjs:237,243` and `test/invoice-pay.test.mjs:89`: nonce vectors (keccak outputs, public).
- `test/onchain.live.test.mjs:9`: the public smoke-sale tx hash.

No keys. The private design-system link is gone: no `claude.ai/artifact` hit in apps/web, docs or .batches.

## FOLLOW-UP (fix in the next batch; none blocks)

### F1 MEDIUM: anyone can hold any invoice in "confirming" with throwaway keys (owner: claude-frontend)
- **Where:** `app/api/v1/invoices/[id]/pay/route.ts:57-61` (verify, then `claimPayment`), `:67/:71` (pending) and `app/pay/[invoiceId]/page.tsx:51` (in flight: the "pending" sheet with no button).
- **Exploit:**
  1. Invoice ids are sequential and their terms are public on chain, so a script loops: new key → sign `invoiceAuthorization` → POST `/api/v1/invoices/N/pay`.
  2. Each signature is valid, so it takes the `invoice:N` lock while the relayer reads the payer's balance (about 1 s) and answers `insufficient_funds`.
  3. With a few requests always in flight, the real customer's page renders "Confirming… Don't pay again" with no button, and their POST gets 409 "confirming".
  4. Any unknown outcome the attacker can provoke (for example, emptying a funded key between the relayer's simulation and inclusion, so the transaction mines and reverts with 502) keeps the invoice pending for about 9 min.
  5. Checkouts weren't exposed this way because session ids are random UUIDs.
- **Impact:** availability only. No money can move: every attempt pays the full rest, so the contract allows one success.
- **Fix:**
  - Batch `USDT.balanceOf(payer)` with the invoice and fee read (one multicall), and refuse `< amount + fee` with the demo message before `claimPayment` and before the relayer.
  - Add a per-IP rate limit on the route.
  - Optional: key the lock per (invoice, payer). The contract already stops a second full payment, so the lock is only a UX guard.

### F2 MEDIUM: a refund from a wallet without enough USDT spends an approval first (owner: claude-frontend)
- **Where:** `lib/merchant-wallet.ts:99-104`.
- **What happens:**
  1. With a short allowance, the pre-simulation reverts with "ERC20: transfer amount exceeds balance". TetherTokenV2 checks balance before allowance, as verified above.
  2. The `catch` rethrows only MerchantPay errors, so this one is swallowed.
  3. The merchant pays gas for `approve(amount)`. Only then does the refund simulation fail ("Your wallet doesn't have enough USDT for this refund.").
  4. An allowance of `amount` is left behind. It's harmless (only the merchant's own `refund` can spend it), but the focus rule "nothing spent when the refund would fail" isn't met.
- **Fix:** in that catch, rethrow when the revert reason contains "exceeds balance" (the same test `walletError` already uses at `:122`), or read `balanceOf(w.account)` first. Add a test with a fake wallet whose refund eth_call reverts "exceeds balance": nothing should be sent.

### F3 LOW: the invoice consumer rule doesn't tie the relayer's paymentId to this invoice (owner: claude-frontend)
- **Where:** `lib/onchain.ts:129-136`.
- **Gap:** `payments(id)` carries no invoice id. Suppose a faulty relayer returns the id of another payment by the same payer to the same merchant with the same gross, while the invoice's `paid` rose by `amount` for some other reason (for example, someone else paid). The receipt would then point at the wrong payment.
- **Impact:** this needs a broken relayer, and there is no money impact.
- **Fix:** read the receipt of `result.txHash` and require a MerchantPay `Paid` log with that paymentId, `invoiceId == id` and `payer == from`.

### F4 LOW: surviving mutant S5 (owner: claude-frontend)
- **Where:** `route.ts:64`.
- **Gap:** deleting the in-lock `if (invoiceAttempt(id).receipt) return alreadyPaid(id)` passes all tests. MerchantPay backstops it (`InvoiceNotOpen`, then a 422 and a closed state), so this is only a test gap.
- **Fix:** add one test in which request B reads "open" before A finishes and claims the lock after A has recorded its receipt. Expect 409 `paid:true` and no second relay.

### F5 LOW: index-only values shown as facts (owner: claude-frontend)
- **Where:** `app/merchant/page.tsx:60` (the row amount is the Blockscout `gross`), `:73` ("Sales today" sums it) and `app/r/[id]/page.tsx:84-87` (invoice number, time and tx link come from the index).
- **Gap:** a row whose on-chain `payments(id).merchant` isn't the signed-in merchant still shows ("Can't check right now"). The payment record is already read for every row.
- **Fix:** use `record.gross` and drop rows whose record merchant doesn't match. Nothing here can move money: refunds read the chain and the contract checks `NotMerchant`.

### F6 LOW: the private label can reach our server before hydration (owner: claude-frontend)
- **Where:** `components/merchant/Invoices.tsx:164` and `:175`.
- **Gap:** the form has no `action`/`method` and the label input has `name="label"`. A submit before React hydrates (the dashboard streams) does a native GET to `/merchant?amount=…&due=…&label=…`. That puts the label into server logs and browser history, against "never sent anywhere".
- **Fix:** drop `name` from the label input and read it from state or a ref, or disable the submit button until mounted.

### F7 LOW, product decision (owner: claude-frontend; NEEDS THE USER)
- **Where:** `app/pay/[invoiceId]/page.tsx:58`.
- **Gap:** `/pay/<id>` renders and relays any MerchantPay invoice, including invoices from wallets we never onboarded; the page shows them as "a merchant". Our domain thus serves pay pages for arbitrary payees, which is a phishing surface ("pay your Bandra Beans invoice at our-domain/pay/42").
- **Options:** serve only known merchants (today, `MERCHANT_ADDRESS`), or show the payee's identity.

### F8 LOW: /merchant moves money but has no CSP (owner: claude-frontend)
- **Where:** `next.config.ts:37-39`.
- **Gap:** the dashboard now sends approvals, refunds and invoices. It loads nothing from other origins, so the same `PAY_PAGE_CSP` would fit. Wallet extensions aren't affected by page CSP.

## Relayer (claude-relayer RL2): what our `payInvoice` args imply
Our server sends `{action: "payInvoice", args: {invoiceId, from, amount (credited, without the fee), validAfter: "0", validBefore, salt}, sig}`. The relayer today supports only `pull`; until RL2 ships, invoice payments end as "Nothing was charged" (400). For RL2:
1. **Signature pre-check:** rebuild ReceiveWithAuthorization with `value = amount + relayFee()` (read on chain), `to` = MerchantPay 0xab81…4251 and `nonce = invoiceNonce(invoiceId, amount, salt)` (or call the view). If it verifies with `value = args.amount`, every invoice fails closed.
2. **Balance:** check `balanceOf(from) ≥ amount + relayFee`. Otherwise a payer holding between amount and amount + fee gets `would_revert` instead of `insufficient_funds`, and the customer misses the demo message.
3. **Minimum:** mirror the contract: `amount ≥ 1 USDT` **or** `amount == invoices(id).amount − paid`. Applying `MIN_VALUE` alone would strand a remainder under 1 USDT that someone else's partial payment left.
4. **Rate limits per merchant:** the args carry no merchant, so read `invoices(id).merchant`. Our server relays for any invoice on MerchantPay, from any merchant, so the per-payer, per-merchant and per-IP limits and the daily budget are the drain guard here.
5. **Allowlist and fee:** target 0xab81…4251, selector `payInvoice` only. Before sending, check `feeRecipient() == the hot wallet` and `relayFee() > 0`; otherwise the relayer pays gas for nothing.
6. **Gas:** a financed invoice routes through `CapitalMarket.onPayment`, about 537k gas with 8 holders (ARCHITECTURE §3), which is above the 400k cap. It must be refused before sending (503/422), never sent to fail out of gas: that would surface as a 502 and leave a needless "pending" on our side.
7. **Response:** take `paymentId` from the receipt's `Paid` log (topic1, with `invoiceId == args.invoiceId`), never from `paymentCount`. Keep returning `blockNumber`; our consumer rule reads at that block.

## Carried from batch 004 round 2 (verified)
- **Security F1:** `sessions/[id]/pay/route.ts:24` has `&& !isInFlight(id)`, and `checkout/[sessionId]/page.tsx` sets the pending prop the same way. Mutant S16 is killed.
- **Security F3:** `checkout/[sessionId]/not-found.tsx` no longer promises "Nothing was charged".

## Files
- Reviewed: `apps/web/app/api/v1/invoices/[id]/pay/route.ts`, `apps/web/app/api/v1/sessions/[id]/pay/route.ts`, `apps/web/app/pay/[invoiceId]/page.tsx`, `apps/web/app/r/[id]/page.tsx`, `apps/web/app/merchant/page.tsx`, `apps/web/components/{InvoicePay,Confirming,Checkout}.tsx`, `apps/web/components/merchant/{Invoices,Refund,SignIn}.tsx`, `apps/web/lib/{pay,relay,onchain,settle,sessions,merchant-wallet,outcome,sign-sale,config}.ts`, `apps/web/next.config.ts`, `apps/web/test/*`.
- Reviewer scratch (not product code): the mutation runner and fork script are in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/`.
