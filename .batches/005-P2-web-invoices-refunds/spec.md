# Spec: 005-P2-web-invoices-refunds

Request (verbatim): "bhai frontend me aage ka page to banao" · "whast working buikld next" (human, 2026-11-06). G2 acceptance plan (claude-review 01:07): frontend F2, F3, F4.

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-1: a merchant creates an invoice with customer, amount, due date and reference.
- FR-PAY-2: a merchant cancels an invoice that is unpaid and not financed.
- FR-PAY-3: a customer pays an invoice by signing one message; the relayer submits it.
- FR-PAY-7 / NFR-6: plain words on the customer pages.
- FR-PAY-8 / AT-2: a merchant refunds all or part of a payment in one click, from its own wallet; refunds never take money from investors. On the G2 never-cut list.
- FR-PAY-9: receipts with refund status, keyed by the on-chain payment id so they survive restarts.
- FR-PRIV-1: the customer pages make no browser chain reads.
- NFR-12: /pay, /checkout and /r stay ≤ 204,800 B of JS as Chrome downloads it.
- G2 plan F2: switch to the **final MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251`** (claude-contracts 01:35). `0x83b5…` and `0x8eff…` are paused.
- G2 plan F3: `MERCHANT_ADDRESS` = demo merchant `0x37F9315EDF71d9C27b0F650c59e4c96aD6a442B1` (env only).

## Phase 3 MerchantPay rules this batch must follow (deployed source, `contracts/src/MerchantPay.sol`)
- `paySale` is unchanged for us: the customer pays exactly the total, the 0.10 fee comes out of it, and the nonce is the same. It newly refuses merchant = MerchantPay, the market or USDT (`InvalidOrder`).
- **`payInvoice`: the fee is on top.** The customer signs `value = amount + relayFee`, while the nonce is `invoiceNonce(id, amount, salt)` over the **credited amount only**. `gross = amount + fee`. Partial payments are allowed: `amount ≤ amount − paid`, ≥ 1 USDT unless it clears the rest. The invoice turns Paid only when fully paid.
- **Invoice consumer rule:** `payments(paymentId)` has gross == amount + fee, payer == the signer and merchant == the invoice's merchant, **and** `invoices(id).paid` rose by `amount`.
- The fee is read on the server from `relayFee()`, never from the browser. The customer page shows "You pay X (includes a 0.10 USDT network fee)", worded without crypto terms.

## Acceptance criteria
- [ ] **Merge the scratch build (b006) onto batch 004's code**, replaying its changes rather than copying files over. Reuse 004's `freshSalt`, `settle`, `isInFlight` and first-write-wins. Share the pay routes' input checks instead of the 9 duplicated lines.
- [ ] `lib/pay.ts`: `invoiceNonce` / `invoiceAuthorization` with `value = amount + fee`. Live vector tests read from **`0xab81…4251`**'s `saleNonce` and `invoiceNonce` views.
- [ ] `/pay/[invoiceId]` plus `POST /api/v1/invoices/:id/pay`: the money rules are those of batch 004 (server rebuilds from chain data; verify before relay; one in flight; pending settled by the chain; a 422 checks the chain; fresh salt), plus the Phase 3 invoice rules above. Tests cover: the fee on top, a partial payment, the fully-paid status, an `InvoiceNotOpen` refusal → receipt or closed state, and a fee read failure → 503 with nothing sent.
- [ ] Merchant **Invoices** on /merchant: create (a random refHash, never the label; the label stays in localStorage), list (ids from the Blockscout log index, status from the chain), cancel, copy the link. The merchant's own wallet sends these and pays its own gas.
- [ ] **Refunds:** a Refund button per payment that approves exactly the amount, then calls `refund(paymentId, amount)`. The refundable figure comes from `payments(id)`; MerchantPay's errors become plain merchant copy.
- [ ] `/r/<paymentId>` reads `payments(id)` and its Paid log on chain; `/r/<uuid>` stays.
- [ ] **Env:** `MERCHANT_PAY_ADDRESS=0xab81…4251` and `MERCHANT_ADDRESS=0x37F9…42B1` in the git-ignored `apps/web/.env.local`; the relayer must be pointed at the same MerchantPay (claude-relayer RL2).
- [ ] **Privacy (human 01:12 via claude-research):** remove the private design-system link from `apps/web/app/tokens.css` line 1 ("generated from our design system tokens") and from `docs/FRONTEND-PLAN.md`.
- [ ] **Carried from batch 004 round 2:**
  - security F1: an in-flight payment at expiry is pending, not 410 (`&& !isInFlight(id)`, and in the page's pending prop)
  - security F3: the checkout not-found copy doesn't promise "Nothing was charged" after a restart
  - ux L1: "Check again" no longer reads as disabled
  - ux L2: expired isn't shown in error red
  - code F2: the Checkout status mapping becomes a pure function with a 6-row test
  - code F5: one-line tests for the 5 surviving mutants
  - code F6: units on the gas and budget rows
- [ ] **Demo flow (human gate 004, 01:45: "Say it's a demo"):** when a guest wallet holds no USDT, the checkout and invoice pages say plainly that this is a demo and a payment needs a funded test wallet, instead of only "There isn't enough balance". The video's live sale uses the funded customer (G2 H1).
- [ ] typecheck, lint, `npm test` 0 fail, build; the FR-PAY-7 / FR-PRIV-1 scan on /pay and /r; NFR-12 in Chrome for /pay; screenshots at 375 and 1440, light and dark.

## Needs the human (G2 plan)
- H1: where the customer's 25 USDT comes from.
- H2: a browser wallet holding the demo merchant key, for sign-in, invoices and the refund.
- H5: approving the live transactions at the gate.

## Out of scope
- apps/shop (batch 006, G2 F5).
- Neon `app_sessions` and the deploy.
- The advance and investor pages (Phase 3 UI, next).
