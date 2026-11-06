# Spec: 022-P2-relayer-resilience (phase mode, Money: yes)

## Requirements
- **FR-REL-1 / NFR-4:** a relayed sale answers 200 once its own receipt is mined within the 8 s window. One transient RPC error during the receipt poll (a rate limit or a 5xx) must not turn a sale that gets mined into a 502.
- **AT-10 / FR-REL-1 error contract:** a 502 without `txHash` means nothing was sent and the request is safe to re-POST. A request that waited too long for the send lock gets exactly that answer before signing.

## Changes (apps/relayer/src/relayer.ts)
1. **F1b:** `ownReceipt` keeps polling through any RPC error until `TIMING.receiptTimeoutMs`. If no receipt arrives by the deadline, the answer stays as today: 502 `rpc_error` with the `txHash` and the cap fee counted.
2. **F4:** `TIMING.maxRequestAgeMs = 20_000`. Inside the send lock, after the fresh simulate + nonce and before signing, a request older than that gets 502 `rpc_error` "nothing was sent; retry", with no `txHash`. This reuses the existing retry-safe code, not a new 503 code the web doesn't know. 20 s + the 8 s receipt window stays under the web's 35 s give-up and the 60 s `maxDuration`.

## Tests first (test/relayer.test.ts)
- Two receipt-poll errors, then the receipt: 200, sent once.
- Errors on every poll until the deadline: 502 `rpc_error` with `txHash`.
- With `maxRequestAgeMs` shrunk, a second sale queued behind a slow first one gets 502 `rpc_error` without `txHash`, and only one tx is sent.
- Helper: `fakeNode`'s `on` overrides get `next()` for the default answer.

## Acceptance criteria
- [ ] `npm test` (57 + 3) and `npx tsc --noEmit` pass.
- [ ] Deployed; `/health` 200, `/relay` without the secret 401. No live sale is needed (the human approved one, now spent).

## Addendum (11:06, claude-research 11:04 + G4 orders 11:05)
- **Gas guard (FR-REL-1 drain guard, claude-contracts Q19):** add `eth_estimateGas` to the RPC pre-check round, in the same batched request, so no extra round trip. Above the 400k limit the payment is refused with 422 `too_much_gas` and no tx; a full repayment of a 3-holder invoice needs 421,338 gas. A failed estimate (it reverts whenever the call would) leaves the decision to the gas-capped simulation.
- **2-holder cap on invoice funding (claude-research's 10:59 decision; apps/web lib/server/capital-fund.ts):** an invoice claim already held by 2 other investors refuses a 3rd distinct investor with a plain message, before any relay, so its repayment stays under the relayer's gas limit.
- Tests first for both.
