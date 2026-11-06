# Spec: 008-P2-nfr4-async-send (phase mode, Money: yes)

## Requirements
- **NFR-4**: a valid payment is confirmed within 5 s of signing. G2 measured **10.08 s** (AT-1 `0x7e03b5d0…7a11`); profiling: ~7 s inside Ankr's `eth_sendRawTransactionSync`, read rounds 0.35 s warm / ~0.9 s cold (Ankr, venue).
- **NFR-14** (RPC-backed rejects ≤ 500 ms): batching each read round into one HTTP request keeps it on the warm socket (cold 916 → 345 ms).
- **FR-REL-1/3/5** unchanged; batch 002 S3 kept: a 200 needs the receipt for **our** hash.

## Behaviour
1. Live transport: `http(RPC_URL, { timeout: 8 s, retryCount: 0, batch: true })`.
2. Send = `eth_sendRawTransaction` (plain), then poll `eth_getTransactionReceipt(ourHash)` every **300 ms** up to **8 s**; the lock is held until the receipt or the timeout. No viem `waitForTransactionReceipt` (it can return a replacement's receipt, batch 002 S3).
3. Outcomes unchanged: success → 200; mined revert → 502 `reverted` (+ ban, breaker); receipt for another hash → 502 `receipt_mismatch`; send error or no receipt within 8 s → 502 `rpc_error` + `txHash`, the cap counted in the budget.
4. `TIMING` (poll interval, timeout) is an exported object so tests can shrink it.

## Acceptance criteria
- [ ] `npx tsc --noEmit && npm test` pass (tests first); the fake node mines asynchronously and answers receipts; no `eth_sendRawTransactionSync` call anywhere.
- [ ] Every send-outcome test re-expressed on the async path (send error, never mined → timeout, mined revert, receipt mismatch, queued copy behind a timeout, held receipt + queue time).
- [ ] Live after the human's OK: the next relayed sale (G2 re-run) is confirmed in ≤ 5 s from POST to 200; the relayer log/time recorded.

## Files
- `apps/relayer/src/relayer.ts`, `apps/relayer/test/relayer.test.ts`; `.batches/008-P2-nfr4-async-send/*`, `notes/phase-2-relayer.md`.

## Out of scope
- Vercel deploy (next batch), split read/send RPCs.
