VERDICT: PASS

# Security review: 008-P2-nfr4-async-send, round 1 (reviewer-security)

Phase mode (PIPELINE §3b), Money: yes. This is the batch's only review, and only HIGH or CRITICAL findings block. I found none, so the findings below are FOLLOW-UPs.

Scope: `git diff 4d32b3c~1 4c41f5b -- apps/relayer` (`src/relayer.ts`, `test/relayer.test.ts`), `spec.md`, `batch.md`, and batch 002 round-3 S3/S5 for context. I sent no transaction, made no request to the dev servers, printed no `.env` value and edited no code. viem was 2.57.13 (installed).

## Answers

**1. S3 (only our own hash): kept.** `txHash = keccak256(signed)` is computed before the send (`relayer.ts:350`). The hash that `eth_sendRawTransaction` returns is ignored (`:353`). `ownReceipt` asks only for `getTransactionReceipt({ hash: txHash })` (`:319`), and `receipt.transactionHash` is still compared with `txHash` (`:359`). That comparison also guards against a batch response landing on the wrong request, so a mismatch fails closed as `receipt_mismatch`. viem's `waitForTransactionReceipt`, which follows replacements, is not used. In viem, `getTransactionReceipt` throws `TransactionReceiptNotFoundError` only on a `null` result (`_esm/actions/public/getTransactionReceipt.js:33`), so only "not mined yet" keeps the loop polling. Any other error leaves the loop.

**2. S5 (lock covers simulate, send and receipt): kept.** `ownReceipt` is awaited inside `send()`, which runs inside `serialized()` (`:354`, `:395`). The lock is released on a receipt, on the timeout, or on the first non-NotFound poll error. A poll error is treated like a timeout: the response is 502 with the txHash, the send is counted, and the authorization stays in the sent set. The worst-case hold time grew, though (F1).

**3. Can the exported mutable `TIMING` be abused? No (INFO).** Only test code writes it (`test/relayer.test.ts:135-136`). The production importers (`api/relay.ts`, `api/health.ts`, `dev.ts`) never touch it. Request JSON is never merged or assigned into an object, and own properties shadow prototype pollution anyway. Changing `TIMING` takes code running in this process, and such code can already read `RELAYER_PRIVATE_KEY`.

**4. Does batching change a failure mode? Only toward failing closed.** viem's batch scheduler (`_esm/utils/promise/createBatchScheduler.js`, `_esm/utils/rpc/http.js:85-114`) works like this:
- Errors are per item. A reverting simulation inside a batch fails only that call, and `Promise.all` already fails the whole round on any read error, as before.
- A rejected or failed batch (HTTP error, 429, timeout, or a single error for the whole batch) rejects every item in it. Before the lock, that is 502 with no tx. Inside the lock, it is 502 with no txHash, and nothing is sent.
- A short response ("Expected N responses") throws.
- A batch-level error can only be misread as a revert, which means "don't send".
- **A send can be batched with reads.** The raw tx can share a `setTimeout(0)` tick with other requests' pre-check reads or the 3 s balance refresh. If that batch fails or times out, the send's outcome is unknown, and it is handled as before: 502 with txHash, `CAP_FEE_WEI` counted, sent set marked. There is no double pay. The cost is liveness only (F3).
- Responses are matched to requests by sorting on id, not by checking each id, so a node that duplicates ids could mis-assign results. That is a malicious or buggy RPC, which 002's P11 already treats as trusted. S3 still holds in that case through the hash check at `:359`.

**5. Timeout accounting: correct.** On the timeout path (`:355-358`) and the catch path (`:372-374`):
- `recordSend(CAP_FEE_WEI)` counts the budget at the worst case and counts the payer and merchant rate limits.
- `sentAuthorizations.add` already ran before the broadcast (`:351`), so a re-POST of the same body is a 422 `replay`, both in `localChecks` (`:285`) and at lock entry (`:332`).
- The `finally` block drops the balance cache.
- Tests cover this: "after a receipt timeout, re-POSTing … is a replay" and "a timeout adds the capped fee".
- A re-signed payment (new salt) for the same order can't pay twice either, because MerchantPay rejects it with `OrderPaid`, `InvoiceNotOpen` or `WrongAmount`.

## Findings (all FOLLOW-UP, owner claude-relayer)

**F1, MEDIUM (before the Vercel batch): the receipt deadline doesn't bound the poll's own RPC call, so the worst case is about 40 s, above the planned `maxDuration`.**
- Where: `relayer.ts:317-325`. The deadline is checked only after a `getTransactionReceipt` call returns, and each call can take the full 8 s `RPC_TIMEOUT_MS`.
- Worst case: `ownReceipt` alone takes about 16.3 s. One request with no queue takes about 8 (pre-check) + 8 (in-lock round) + 8 (send) + 16.3 ≈ 40 s. An invoice with a cold `relayFee` read takes about 48 s.
- `notes/phase-2-relayer.md` plans `maxDuration` ≥ 30 s (and D5 says ≥ 35 s). On Vercel, the function could be killed after the broadcast. The client would then get a 504 with no txHash and could re-POST to another instance (002 P2). The result is a revert that costs us gas and bans the payer. Payment can't happen twice: `authorizationState` and the order binding prevent it.
- Fix: cap each poll at the time left (`Promise.race` with the remaining deadline, or stop when `Date.now() + RPC_TIMEOUT_MS > deadline`), and/or set `maxDuration` ≥ 45 s. Also update the stale comments at `:17-18` ("two RPC timeouts … then the sync send") and `:382` ("sync send").

**F2, LOW (liveness): one transient poll error ends the wait early.** At `:319-322`, a single 429 or timeout on one poll turns a payment that will succeed into 502 `rpc_error` with txHash, and releases the lock while our tx is still pending. Nothing is lost: the client polls the txHash. Fix: treat non-NotFound errors like `null` until the deadline, and rethrow only at the deadline.

**F3, LOW: the send can share a batch with unrelated reads.** See answer 4. A flood of pre-checks, which are free on this path (002 P4, still open), can make a batch fail or time out in the same tick as an honest send. Each such send is counted as 0.0024 WBT, so about 41 of them use up the 0.1 WBT daily accounting budget without any real spend. The `x-relay-secret` gate (`api/relay.ts:7-10`) limits who can do this to our own web server. Fix: send through a second client built without `batch` (or `{ batch: false }` on the send path only), so a broadcast is never coupled to reads. That also keeps the send off a slow co-batched `eth_call`.

**F4, LOW (test gap): `batch: true` is only on the live transport (`:92`), and no test covers it.** The fake node uses its own transport. Before the G2 re-run, check that Ankr accepts batches that include `eth_sendRawTransaction` (or apply F3). Optionally add one test against a local HTTP fake that rejects the whole batch, and assert nothing is sent and the response is 502 without txHash.

**INFO:**
- The `'not mined within 8 s'` text at `:357` is hardcoded and ignores `TIMING`.
- After a timeout, a later on-chain revert never trips the ban or breaker. This is unchanged, 002's P10, and less likely now with an 8 s wait instead of 4 s.

## DONE (evidence)

- `cd apps/relayer && npx tsc --noEmit` exited 0. `npm test` gave `tests 49 · pass 49 · fail 0`, duration 1.97 s. The only stderr is the expected `ALERT reverted` line from the breaker test.
- `eth_sendRawTransactionSync` remains only in comments (`relayer.ts:14,20`) and in the test's "never called" list (`test:375`).
- Required grep `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over `src/relayer.ts`, `test/relayer.test.ts`, `.batches/008-P2-nfr4-async-send/*.md` and `notes/phase-2-relayer.md` (64-hex values masked in the output). Hits:
  - `relayer.ts:83,84,89`: the env var name and fixed error text.
  - `test:738-747`: a key-validation test that saves and restores the env var and asserts the name.
  - `test:218` `0xcdcfacb6…1d3d2a25`: USDT's public `DOMAIN_SEPARATOR`.
  - `test:563` `0xffffffff…d0364141n`: the secp256k1 curve order.
  - `notes:3,53,56`: env var names in prose.
  - None of these is a secret.
- Unchanged by this diff: the allowlist (MerchantPay `paySale`/`payInvoice` only), fees and gas cap, local signing with every field set, the `ReceiveWithAuthorization`-only typehash, the 30 s re-check before signing, ledger checks inside the lock, and `x-relay-secret` with a constant-time compare.
