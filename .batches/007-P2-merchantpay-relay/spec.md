# Spec: 007-P2-merchantpay-relay

## Requirements (cite docs/SRS.md IDs)
- **FR-REL-1**: the relayer submits signed **sale** and **invoice** payments (`MerchantPay.paySale`, `payInvoice`) and returns the tx hash and the `paymentId`; **FR-PAY-3** / **FR-PAY-5** (a customer pays by signing one message), **FR-PAY-6** (the nonce the relayer checks is the one the contract recomputes).
- **FR-REL-2**: the allowlist becomes exactly MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251` `paySale` (0x96d2584e) and `payInvoice` (0xcdb71426); PullStub `pull` is removed (batch 002 security P3). `refund` is never relayed (the merchant's own tx).
- **FR-REL-3 / FR-REL-5 / AT-10**: every batch-002 guard stays (free checks, one RPC round, gas-capped simulation, lock, re-checks, 400k gas, 6 gwei, sync send, receipt-hash check). AT-10's "unprofitable" half: the 6 gwei cap (break-even for the 0.10 fee).
- **NFR-4 / NFR-14**: `RPC_URL` default becomes `https://rpc.testnet.whitechain.io` (human 02:44; drain review: ~2× faster than Ankr, one backend).
- Research queue item 3: `gasUsed` and the gas cost per relayed payment in the response (for receipts); frontend's 00:09 ask: a distinct `order_paid` code.

## Interface
- `POST /relay` (content-type JSON, unchanged auth until batch 006):
  - `{"action":"paySale","args":{"merchant","orderRef":"0x<32B>","from","amount","validAfter","validBefore","salt":"0x<32B>"},"sig":"0x<65B>"}` — the payer signed `ReceiveWithAuthorization{from, to: MerchantPay, value: amount, validAfter, validBefore, nonce: keccak256(abi.encode(1874, MerchantPay, KIND_SALE=2, uint256(merchant), orderRef, amount, salt))}` (`packages/shared/contracts.ts` `nonceParams`).
  - `{"action":"payInvoice","args":{"invoiceId","from","amount","validAfter","validBefore","salt"},"sig"}` — `amount` = the credited amount; the payer signed `value = amount + relayFee`, `nonce = keccak256(abi.encode(1874, MerchantPay, KIND_INVOICE=1, invoiceId, 0x00…00, amount, salt))` (MerchantPay.sol `payInvoice` / `invoiceNonce`).
  - 200 `{txHash, blockNumber, paymentId, gasUsed, gasCostWei}` (decimal strings; `paymentId` from the `Paid` event of our own receipt).
- New codes: **422 `bad_merchant`** (sale `merchant` is 0, MerchantPay, CapitalMarket or USDT — claude-contracts S6 / L4), **422 `order_paid`** (simulation reverts `OrderPaid` or `InvoiceNotOpen`), **422 `wrong_amount`** (`WrongAmount`); `pull` → 400 unknown action.
- Free checks per action: window, signature (recovered against the action's message), sent set; the **1 USDT minimum applies to sales only** (an invoice's exact remainder may be below 1 USDT; the contract enforces its own rule). `relayFee` for invoice signatures comes from a single-flight read cached 60 s.
- One RPC round as in batch 002: `authorizationState`, `getCode`, `balanceOf(from) ≥ value` (sale: amount; invoice: amount + fee), `eth_gasPrice`, gas-capped simulation.

## Acceptance criteria
- [ ] `npx tsc --noEmit && npm test` pass; tests first (RED commit); every batch-002 test kept, re-expressed on `paySale`.
- [ ] Unit tests: `paySale` and `payInvoice` → 200 with `paymentId`/`gasUsed`/`gasCostWei` from the receipt; the signed raw tx goes to MerchantPay with exactly the request's args (decoded with `merchantPayAbi`); the locally computed nonces equal the contract formula (pinned against a vector computed with `encodeAbiParameters(nonceParams, …)`); `bad_merchant` for each forbidden merchant with no RPC; `order_paid` for `OrderPaid` and `InvoiceNotOpen`, `wrong_amount` for `WrongAmount`; an invoice signed for `amount` alone (fee missing) → `bad_signature`; an invoice remainder below 1 USDT is not rejected locally; `pull` → 400; only the two selectors ever reach `eth_sendRawTransactionSync`.
- [ ] Live, read-only: the local `saleNonce` / `invoiceNonce` equal `MerchantPay.saleNonce` / `invoiceNonce` on chain for one sample (`cast call`); `relayFee()` read live.
- [ ] Live, no tx: a `paySale` from a fresh 0-USDT payer → 422 `insufficient_funds`; a forbidden merchant → 422 `bad_merchant`; relayer nonce unchanged.
- [ ] The live relayed sale itself is the G2 joint run (AT-1, human 02:51).
- [ ] NFR-3 grep unchanged (`PORT`, `RELAYER_PRIVATE_KEY`, `RPC_URL`).

## Files (claude-relayer only)
- `apps/relayer/src/relayer.ts`, `apps/relayer/api/relay.ts`, `apps/relayer/test/relayer.test.ts`; imports `packages/shared/contracts.ts` (read-only, claude-contracts' generated file).
- `.batches/007-P2-merchantpay-relay/*`, `notes/phase-2-relayer.md`

## Ponytail ladder
- Reuse the batch-002 pipeline; an action = {target, function, args, the payer's authorization}. Two actions, so a small table, no class hierarchy.
- ABI, addresses, domain, types, nonce params and `MIN_PAYMENT` come from `packages/shared/contracts.ts` (no local copies: reviewer-code F2 from batch 002). Error names come from viem's decoded revert (`errorName`).
- No new dependency.

## Out of scope
- `CapitalMarket.fundWithAuthorization` (investor funding; G5 Capital tab), batch 006 (Postgres, limits, budget, breaker, `/relay` secret), Vercel deploy, fee swap.
- Known limit (documented): a sale routed to an advance with many holders can exceed 400k gas (claude-contracts M2: 8 holders = 536k) → simulation fails → 422 `would_revert`; such sales are fee-negative anyway.

## NEEDS THE USER
- `RPC_URL` default switch (approved 02:44). No new limits, keys or dependencies.
