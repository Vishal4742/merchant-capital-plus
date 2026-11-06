STATUS: READY

# Build: 007-P2-merchantpay-relay (claude-relayer)

## DONE
- `apps/relayer/src/relayer.ts`: `parsePayment` (actions `paySale` / `payInvoice`; `pull` → 400); the authorization nonce is recomputed as MerchantPay does (`keccak256(abi.encode(1874, MerchantPay, kind, ref, orderRef, amount, salt))`, `packages/shared` `nonceParams`); invoices sign `amount + relayFee` (single-flight read, cached 60 s); local `bad_merchant` (0, MerchantPay, CapitalMarket, USDT); the 1 USDT minimum applies to sales only; simulation reverts decoded with `merchantPayAbi` → `order_paid` (OrderPaid, InvoiceNotOpen), `wrong_amount`, `bad_merchant` (InvalidOrder), else `would_revert`; 200 adds `paymentId` (our own `Paid` log), `gasUsed`, `gasCostWei`. All batch-002 guards unchanged (free checks, one RPC round, lock, re-checks, 400k gas, 6 gwei, sync send, receipt-hash check, sent set, /health cache + refresh). Default `RPC_URL` → `https://rpc.testnet.whitechain.io` (human 02:44).
- `apps/relayer/api/relay.ts`: no PullStub constant; target is MerchantPay from `packages/shared/contracts.ts`.
- `apps/relayer/tsconfig.json`: `module: "preserve"` so the generated `packages/shared/contracts.ts` (no package.json of its own) type-checks; Node loads it as ESM at runtime (checked).
- Tests: every batch-002 test re-expressed on `paySale` (stateful fake node recomputes the nonce from each call; receipts carry a real `Paid` event); new: nonce formula pinned with an independent `encodeAbiParameters` layout, `paymentId`/`gasUsed`/`gasCostWei`, `payInvoice` (value = amount + fee, call carries the credited amount), invoice signed without the fee → `bad_signature`, invoice remainder < 1 USDT accepted locally, `bad_merchant` ×4 with no RPC, `order_paid` ×2 + `wrong_amount`.
- Commits: `827ffe8` test (RED: `relay()` signature + `pull`-only parser; a clean RED count was impossible because the lock tests' wait loops never exit against the old code) → `8259489` feat (GREEN).

## Verified
- `npx tsc --noEmit` → 0 · `npm test` → `tests 42, pass 42, fail 0` (0.98 s).
- Live read-only (Whitechain RPC): local `saleNonce` = on-chain `MerchantPay.saleNonce` (`0xae742da4…da8c`) and local `invoiceNonce` = on-chain `invoiceNonce` (`0x8c7c354c…9cb4`) for the same inputs; `relayFee()` = 100000.
- Live, no tx (dev server, fresh random 0-USDT payers): USDT as merchant → 422 `bad_merchant` (15 ms); `pull` → 400; `paySale` ×20 → 422 `insufficient_funds`, **p50 146 / p95 266 ms** (NFR-14 ≤ 500 ms met from the venue on Whitechain's RPC; Ankr was 349–1,649). Relayer nonce 3 before and after.
- NFR-3 grep: `PORT`, `RELAYER_PRIVATE_KEY`, `RPC_URL`.

## OPEN
- The live relayed sale = the G2 joint run (AT-1, human 02:51); team wallet funding via the seed reclaim (claude-research arranging).
- Known limit: a sale routed to an advance with many holders can exceed 400k gas (8 holders = 536k) → 422 `would_revert`.
- Batch 006 (Postgres lock, rel_sent, limits, budget, breaker, `x-relay-secret`) resumes after this batch.
