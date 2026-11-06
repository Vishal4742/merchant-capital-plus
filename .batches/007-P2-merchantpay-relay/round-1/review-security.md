VERDICT: PASS

# Security review: 007-P2-merchantpay-relay, round 1 (reviewer-security, fast mode §3a)

Code: `git diff 827ffe8~1 8259489 -- apps/relayer` (`src/relayer.ts`, `api/relay.ts`, `test/relayer.test.ts`, `tsconfig.json`). Line numbers are for `8259489`.
Safety: no transaction sent and no request made to the dev server. My only chain access was read-only `cast call/nonce/balance/gas-price/code/client` against `rpc.testnet.whitechain.io`. No `.env` value printed: I counted `^RPC_URL=` lines in `apps/relayer/.env` (0) and printed nothing else from it. Relayer `0xdd02…a651`: nonce 3 latest / 3 pending, 0.498377508835749934 WBT, unchanged.

No new HIGH or CRITICAL. This passes for a localhost relayer. It does **not** clear a public deploy (see NEEDS THE USER).

## DONE (checked)

- **Only two calls are possible.** `to` is the constant `MERCHANT_PAY` (`relayer.ts:41,280`). The calldata comes from literal function names (`:242-244`) and only from parsed, typed args (`:206,212`). There is no `value` field, so 0 WBT goes out with each tx. `refund` is unreachable. `pull`/PullStub are gone from `apps/relayer` (grep: 0 hits). **Batch 002 P3 is closed.**
- **The payment can't go anywhere else.** The local nonce (`:146-147`) matches the chain. I checked this myself with `cast abi-encode` + `keccak`: `saleNonce(0x1111…, 0xabab…, 2500000, 0xcdcd…)` = `0x04fa7ceb…303d`, and `invoiceNonce(7, 999, 0xcdcd…)` = `0x516a57d1…fa2d`, both equal on chain and locally. The signature is recovered only as `ReceiveWithAuthorization` with `to = MerchantPay` (`:228-233`). MerchantPay recomputes the nonce (`MerchantPay.sol:157,185`), so a signature pays only its own order or invoice. `from` = the relayer wallet is impossible because the relayer never signs typed data.
- **Forbidden merchants** (`:42,221`) are rejected before any RPC call. On chain: `market()` = shared `capitalMarket` `0xEcd6…0ABE`, and `usdt()` = shared USDT. The contract repeats the check (`MerchantPay.sol:176-179`).
- **The invoice fee on top is consistent.** The signature value, the balance check and the contract's pull all use `amount + relayFee` (`:217,228,248`; `MerchantPay.sol:157`). An invoice signed for `amount` alone gets `bad_signature` (tested). Inflating `amount` changes the nonce, so the signature check fails.
- **relayFee cache.** It can only be poisoned through the RPC (P11, trusted). If it's stale (≤ 60 s after `setRelayFee`), a signature over the new fee gets 422 `bad_signature` locally (availability only) and a signature over the old fee fails simulation (`would_revert`). Neither path spends gas. A failed read is not cached (`:119`). Live `relayFee()` = 100000.
- **Invoice remainder < 1 USDT** is not dust. The 0.10 fee is on top for every invoice payment whatever the amount, and `feeRecipient()` = the relayer wallet itself.
- **orderRef 0 / paused / InvoiceNotOpen / WrongAmount** are all caught by the gas-capped simulation and return 422. No gas is spent; the only cost is one RPC round (the batch 002 P4 class). Live `paused()` = false.
- **Shared-state front-runs** (another wallet pays the same `orderRef`, or pays down the invoice, after our in-lock simulation) revert early in MerchantPay (`OrderPaid` / `WrongAmount` come before any write). That costs us about 30–50k gas, while the griefer pays ≥ 1 USDT + 0.10 to the merchant. The griefer loses more than we do.
- **The RPC switch** (`:14,80`; `.env` sets no `RPC_URL`, so this default is live). The endpoint is the chain operator's own `op-reth/v2.8.1`. The trust model is unchanged (P11): we sign locally with chainId 1874 and a constant `to`, so the RPC can't redirect a tx. Ankr is gone as a third party, there's one backend (which narrows drain-review R7), and the URL has no key. The public rate limit is unknown, so P4 still applies.
- **Error bodies.** Responses carry only viem `shortMessage` (`:89`). In viem 2.57.13 the URL appears only in `metaMessages` (`errors/request.js:14,101,164`). The key-error messages are fixed strings (`:73,78`). A test checks that no URL token is echoed (`test:483-493`). The diff adds no log lines.
- **Required grep** over the 4 diff files, every batch `.md` and `notes/phase-2-relayer.md`: `PRIVATE_KEY` hits are only the env-var name (`relayer.ts:72-78`, `test:702-711`, docs). The 64-hex hits are public constants: the USDT DOMAIN_SEPARATOR (`test:188`) and the secp256k1 order n (`test:530`). Test keys come from `generatePrivateKey()` at runtime. `apps/relayer/.env` is git-ignored.

## FOLLOW-UP (MEDIUM/LOW, owner claude-relayer unless noted)

- **F1 LOW, `relayer.ts:202-203,164`.** `orderRef = 0x00…00` passes the local checks and costs an RPC round before the contract's `InvalidOrder`. It is then reported as `bad_merchant`. Fix: reject `orderRef === zeroHash` in `parsePayment` (400 `bad_order`), and map `InvalidOrder` to one code that covers both cases.
- **F2 LOW, the fee-negative ceiling.** Sales routed to a many-holder advance are relayed up to 400k gas. At 5–6 gwei that's about 0.15–0.18 USDT of gas against the 0.10 fee, which comes back to our wallet. Someone who controls both a merchant and its holders loses about 0.10 per round while we lose about 0.05–0.08 net. Fix: the batch 006 budget/breaker, or read `estimateGas` in the parallel round and refuse when est × gasPrice exceeds what the fee covers.
- **F3 LOW.** The relayer never checks `relayFee > 0` or `feeRecipient` for sales. If the owner changes either, relaying becomes a pure gas gift (owner-trust). Fix: refuse (503) when the cached `relayFee` is below break-even.
- **F4 INFO, owner human/claude-contracts.** `feeRecipient` = the hot wallet, so USDT fees pile up behind the hot key. Sweep them regularly or point `feeRecipient` at the team wallet.
- **F5 LOW.** `EnforcedPause` becomes a generic `would_revert`. A 503 `paused` would tell the client to retry later.
- **Carried from batch 002, still open:** P1(b) `getCode` is still missing from the in-lock round (`:269-272`), P5 (queue cap), P7, P9 (`content-length` before `request.text()`, `api/relay.ts:9`), P10 (gas price 5.001 gwei against the 6 gwei cap leaves 20% headroom). P6 is closed (6 gwei).

## NEEDS THE USER

1. **No public deploy and no `RELAYER_PRIVATE_KEY` in Vercel yet.** These still have to land first (batch 006): P1/R1–R2, the revert breaker plus `getCode` in the lock; P2, the Postgres advisory lock + `rel_sent`; P4/P5, per-IP and per-payer limits plus a queue cap; the daily budget; the `x-relay-secret` on `/relay`; and P9. `/relay` is still unauthenticated (`api/relay.ts:4-10`).
