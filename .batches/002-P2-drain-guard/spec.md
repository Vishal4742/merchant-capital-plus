# Spec: 002-P2-drain-guard

## Requirements (cite docs/SRS.md IDs)
- **FR-REL-2** allowlist: the target + function stay server constants (PullStub `pull` now; MerchantPay `paySale`/`payInvoice` in batch 004 when `packages/shared` has the ABI).
- **FR-REL-3** simulate every tx and never send one that would revert: simulation now runs **inside the send lock**, after the previous send is mined, so two requests can't both pass on stale state.
- **FR-REL-5** (the parts that need no database): gas price cap (`maxFeePerGas` ≤ 6 gwei), gas limit 400k, short signature windows (`validBefore` ≤ now + 15 min). Rate limits and the daily WBT budget need Neon → batch 003.
- **FR-REL-4** (relayer half): minimum payment 1 USDT (`value ≥ 1_000_000`). The fee inside the tx is MerchantPay's (batch 004); PullStub has no fee path, so it is never relayed publicly.
- **FR-REL-1 / FR-REL-6** unchanged surface; `/health` keeps its shape.
- **AT-10** (PullStub path): invalid calls are rejected before sending with no gas spent. The "unprofitable" half (fee < gas cost) needs MerchantPay's fee → batch 004.
- **NFR-4 / NFR-14**: a valid payment ≤ 5 s via `eth_sendRawTransactionSync`; an invalid `/relay` rejected ≤ 500 ms with no tx; `GET /health` ≤ 300 ms p95.
- **NFR-3** + human gate decision 1 (22:01): `npm run dev` loads a scoped `apps/relayer/.env` that holds only `RELAYER_PRIVATE_KEY`.
- ARCHITECTURE §3 drain guard points **1, 2, 3, 4 (minimum), 5, 6, 11**, plus round-3 security findings S3, S5, S6, S7, S9 from batch 001.

## Behaviour (order of checks; each stops at the first failure)
1. **Body** (no RPC): 4 KB byte cap — `dev.ts` stops reading and answers **413** past 4,096 bytes; `api/relay.ts` answers **415** unless the media type is `application/json` (parameters like `; charset=utf-8` allowed; forces a CORS preflight, so a cross-site form can't post). `dev.ts` forwards the `content-type` header to the handler and answers **403** unless the `Host` header is `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding). Malformed JSON/fields → **400** `bad_request` as today.
2. **Local pre-checks** (no RPC) → **422** with a stable `code`:
   - `not_yet_valid`: `validAfter > now`
   - `expired`: `validBefore < now + 30 s` (too little time left to be mined)
   - `window_too_long`: `validBefore > now + 15 min`
   - `below_minimum`: `value < 1 USDT`
   - `bad_signature`: the EIP-712 `ReceiveWithAuthorization` (USDT domain `Tether USD` / `1` / 1874 / USDT, `to` = the target) does not recover to `from`
3. **RPC pre-checks**, one parallel round of plain `http` requests (no JSON-RPC batching: a batched sync send would make a concurrent `/health` wait for its receipt; probes showed no gain), outside the lock, judged in this order:
   - `replay` (422): `(from, nonce)` is in the in-process **sent set**, or `USDT.authorizationState(from, nonce) == true`
   - `payer_has_code` (422): `eth_getCode(from)` is not empty (viem returns `undefined` for `0x`), including EIP-7702 delegations (drain-guard point 11, human decision 4)
   - `insufficient_funds` (422): `USDT.balanceOf(from) < value`
   - `gas_price_cap` (**503**, retry later): `eth_gasPrice > 6 gwei`
   - `would_revert` (422): `simulateContract` **with the same gas limit and fees we sign with** (an un-capped `eth_call` gets the 40M block gas, so a gas-burning signer would pass simulation and burn our 400k on-chain); other simulation failures → 502 `rpc_error`.
   Every rejection therefore costs one round trip (NFR-14 ≤ 500 ms).
4. **Send lock** (in-process FIFO promise chain, `.then(run, run)` so a throwing send never blocks later requests), inside it:
   - re-check `validBefore ≥ now + 30 s` (queue time counts) and the sent set
   - parallel `simulateContract` (gas-capped, catches a duplicate or any state change since step 3) + `getTransactionCount(relayer, 'pending')`
   - sign locally with explicit `chainId 1874`, `nonce`, `gas 400_000`, `maxFeePerGas 6 gwei`, `maxPriorityFeePerGas 0.001 gwei` (constant: the node's own suggestion, `ponytail:` cap it from the node if the testnet ever gets busy). Every field is set, so viem doesn't call `eth_fillTransaction` and the node can't pick our fees.
   - `txHash = keccak256(signedTx)` computed **before** sending; add `(from, nonce)` to the sent set; then `eth_sendRawTransactionSync` with a 4 s inclusion timeout (one call returns the receipt). The http transport has an 8 s timeout and **no retries** (round 1, F2: viem's default 3 retries could hold the lock ~33 s), so the lock is held for at most two RPC timeouts; `validBefore ≥ now + 30 s` is re-checked again **just before signing**. `/health` serves a WBT balance at most 5 s old, cleared by every send (human 23:27).
   - 200 `{txHash, blockNumber}` only if `receipt.transactionHash == txHash` and status success; mined but reverted → 502 `reverted` + `txHash`; receipt for another hash → 502 `receipt_mismatch` + `txHash`; send error/timeout → 502 `rpc_error` + `txHash` (the client polls the hash, never re-POSTs; the sent set stops a re-POST from paying twice). **A 502 without `txHash` means nothing was sent** (an RPC read or simulation failed; with retries off, an Ankr 429 or blip lands here), so re-POSTing the same body is safe (round 2, F7; sent to claude-frontend 00:36).
5. Error bodies: `{error, code}` — `error` is developer text, `code` is what the UI maps (sent to claude-frontend). Node failures never say "reverted": `isRevert` also requires the revert data to be hex.
6. `relayerClient()` rethrows a fixed message if the key fails to parse (S9: noble prints the number).

## Acceptance criteria (each must be checkable)
- [ ] `cd apps/relayer && npx tsc --noEmit && npm test` passes; tests written first and committed RED (`test:` commit) before the code.
- [ ] Tests (fake node via viem `custom`, recording every RPC method), one per row of Behaviour 1–6:
  - [ ] each local pre-check → 422 with its `code` and **zero** RPC calls;
  - [ ] each RPC pre-check (incl. `would_revert`) → 422/503 with its `code` after exactly one round, and no `eth_getTransactionCount`, no `eth_sendRawTransaction*`;
  - [ ] every simulation `eth_call` carries `gas` 0x61a80 and `maxFeePerGas` 6 gwei;
  - [ ] valid → 200; the signed raw tx has `gas` 400,000, `maxFeePerGas` 6 gwei, `maxPriorityFeePerGas` 0.001 gwei, the node's pending nonce, chain 1874, `to` = target, calldata = exact args; sent with `eth_sendRawTransactionSync`; no `eth_fillTransaction`, `eth_estimateGas`, `eth_sendRawTransaction`, `eth_getTransactionReceipt`;
  - [ ] two concurrent requests with the **same** authorization → exactly one send, the other 422 (`replay` or `would_revert`);
  - [ ] after a sync-send **timeout**, re-POSTing the same authorization → 422 `replay` with no second send (sent set);
  - [ ] two concurrent **different** valid requests → nonces n and n+1, and the second simulation inside the lock runs after the first send finished;
  - [ ] a send that throws releases the lock: the next request is still sent;
  - [ ] receipt for a different hash → 502 `receipt_mismatch`; mined-but-reverted → 502 `reverted`; sync timeout → 502 `rpc_error`; each with our `txHash`;
  - [ ] -32603 with non-hex data during simulation → 502 `rpc_error`, and its message doesn't say "revert";
  - [ ] the exported USDT domain hashes to the on-chain `DOMAIN_SEPARATOR` `0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25`;
  - [ ] `api/relay.ts` with `content-type: text/plain` → 415 before any key or RPC use;
  - [ ] `dev.ts` (spawned with no key): a JSON POST is **not** 415 (the header is forwarded); a 5 KB body → 413 and the server keeps answering; a foreign `Host` → 403; `GET /health?x=1` reaches the handler;
  - [ ] an unparsable 64-hex key → `relayerClient()` throws a message that doesn't contain the key.
- [ ] **Live** (needs the human's OK; one tx from the relayer, payer `0xE53f…309b` refunded first, see NEEDS THE USER): a valid 1 USDT pull through `POST /relay` → 200; the explorer shows gas limit 400,000 and maxFeePerGas 6 gwei; payer 0 WBT before and after.
- [ ] **Live, no tx** (AT-10 PullStub half): replay of a used authorization → 422 `replay`; dust (1 unit) → 422 `below_minimum`; a contract as `from` (e.g. the USDT address) → 422 `bad_signature` locally (an ECDSA signature can't recover to a contract, so ERC-1271 payers never reach the chain); relayer nonce unchanged after all of them. `payer_has_code` (EIP-7702-delegated EOA: valid ECDSA signature, but code `0xef0100…`) is covered by a unit test only, since making a live delegation needs an outward tx.
- [ ] **Live** checks as commands: `cast tx <hash> --json | jq '.gas,.maxFeePerGas,.maxPriorityFeePerGas'` → `0x61a80`, `0x165a0bc00`, `0xf4240`; `cast balance 0xE53fBc545e9b72f315699e3295a8A300c192309b` → 0 before and after; `cast nonce 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651` unchanged across every rejected request.
- [ ] **NFR-14 timed runs** (20 requests each, warm, recorded in test.md): `GET /health` p95 ≤ 300 ms; invalid `/relay` p95 ≤ 500 ms for a local reject (`below_minimum`), an RPC reject (`replay`) and a simulation reject (`would_revert`); the live valid payment POST → 200 ≤ 5 s.
- [ ] NFR-3: `grep -rhoE 'process\.env\.[A-Z_]+' apps/relayer --include='*.ts' --exclude-dir=node_modules | sort -u` → exactly `PORT`, `RELAYER_PRIVATE_KEY`, `RPC_URL`; `cut -d= -f1 apps/relayer/.env` → only `RELAYER_PRIVATE_KEY`; `git check-ignore apps/relayer/.env` passes; `npm run dev` uses it.

## Files to touch (owner lane: claude-relayer only)
- `apps/relayer/src/relayer.ts` (guards, lock, sync send), `apps/relayer/api/relay.ts` (415), `apps/relayer/dev.ts` (413, Host, scoped env), `apps/relayer/package.json` (dev script), `apps/relayer/test/relayer.test.ts` (+ batch-001 reviewer-code LOW-1/2 test cleanups)
- `apps/relayer/.env` (git-ignored, created with `grep '^RELAYER_PRIVATE_KEY=' ../../.env > .env`, nothing printed; never committed)
- `.batches/002-P2-drain-guard/*`, `notes/phase-2-relayer.md`

## Ponytail ladder (why this is the smallest change that works)
- **Needed?** Yes: FR-REL-2/3/5 and AT-10 gate G2, and the drain vectors from batch 001's review are live once anyone can reach `/relay`.
- **Already in repo?** Extend `src/relayer.ts`; reuse viem `recoverTypedDataAddress`, `readContract`, `simulateContract`, `sendRawTransactionSync`, `account.signTransaction`.
- **Plan review (plan-reviewer, 22:58): READY WITH CHANGES**, all adopted except S1's host guard: at the 001 gate the human chose "no `RELAYER_PRIVATE_KEY` in Vercel" over a code guard, so "PullStub is never relayed publicly" stays a **human-enforced control** until batch 004 switches the target to MerchantPay (on the PullStub path every pull must move ≥ 1 USDT to the team wallet, so it is not an economic drain).
- **stdlib:** the lock is a 4-line promise chain; no mutex library. Node `--env-file` for the scoped env.
- **No new dependencies.**
- `ponytail:` markers: in-process lock and sent set (one process; upgrade: Postgres advisory lock + a `rel_sent` table in batch 003 for multi-instance Vercel); constant 0.001 gwei priority fee.
- Measured to pick the design (warm, venue → Ankr): single read 176 ms p50 / 181 ms p95; `getTransactionCount('pending')` 365 ms; a 4-read batch ≈ 370 ms; JSON-RPC batch accepted. So: pre-checks = 1 round, lock round = simulate ‖ nonce, then one sync send.

## Out of scope
- Rate limits per payer/merchant/IP (point 7), daily WBT budget (8), `/health` `gasSpentToday`/`budgetLeft`, pause switch + alert (10), Postgres advisory lock → **batch 003 (needs Neon `DATABASE_URL`)**.
- MerchantPay `paySale`/`payInvoice`, `paymentId` from `Paid`, fee-vs-gas profitability (AT-10 second half), `fund`/`acknowledge`/`register` → **batch 004 (needs the ABI in `packages/shared`)**.
- Vercel deploy (human decision 2: no key in Vercel until this guard **and** batch 003 pass), fee swap (FR-REL-8), `/schedule` (FR-PAY-14).

## NEEDS THE USER (PIPELINE.md §11)
- **Limits** in this batch: gas limit 400k, `maxFeePerGas` 6 gwei (human 00:45 lowered it from 10: break-even ≈6.2 gwei for the 0.10 USDT fee), window ≤ 15 min (all from ARCHITECTURE §3); **new number:** `validBefore` must leave ≥ 30 s (so a tx can't expire between check and mining); minimum 1 USDT.
- **Key file:** create `apps/relayer/.env` with only the relayer key (approved in principle at the 001 gate).
- **Live run:** the G1 payer has 0 USDT now. The live check needs ~1 USDT sent team wallet → payer (one tx from the deployer/team key; the USDT returns to the team wallet through the stub), then one relayed pull from the relayer key (~0.0005 WBT).
- **Neon** for batch 003: is there a Neon project / `DATABASE_URL` for `rel_*` tables, or should I create one?
