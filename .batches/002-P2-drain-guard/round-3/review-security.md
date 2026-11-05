VERDICT: PASS

# Security review: 002-P2-drain-guard, round 3 (reviewer-security)

Code: HEAD `568978b` on branch `relayer`, batch diff `git diff e9a9dff~1 HEAD -- apps/relayer` (6 files: `src/relayer.ts`, `api/relay.ts`, `dev.ts`, `package.json`, `test/relayer.test.ts`, `test/dev.test.ts`). This is the first security review of batch 002. Rounds 1 and 2 ran no security reviewer (batch.md:16, round-2/ has only test.md).

Fast mode (PIPELINE §3a) applies, so only HIGH or CRITICAL blocks. Nothing blocks a relayer that only listens on 127.0.0.1. Every finding below is either a FOLLOW-UP or a must-fix before a public URL. Two of those (P1 and P3) are HIGH once the relayer is public, and they are the reason a pass here does **not** mean the relayer is ready for Vercel (NEEDS THE USER #2).

Safety: I sent no transaction and made no request to the dev server on :8787. Chain reads were `cast nonce/balance/call/storage/code/gas-price/block` and Blockscout GETs. I printed no `.env` value. I read only variable names from `apps/relayer/.env`, and a scratch script compared `.env` values in memory and printed only counts. My body-cap probe ran against a separate `dev.ts` that I spawned on a random port with only `PORT` set, so it had no key. I edited no product code.

Relayer `0xdd02…a651` at the end of the review: nonce 3 (latest) / 3 (pending), 0.498377508835749934 WBT, no code. That matches the tester's 01:34:56 reading, so nothing was sent.

## Answers to the questions asked

**1. Can a request still make the relayer spend gas for nothing?** On localhost, only a process on this machine can reach `/relay`, and such a process could read `apps/relayer/.env` anyway. Per vector:

| Vector | Status after this batch | Where |
|---|---|---|
| Dust | Closed. `value < 1 USDT` → 422 with no RPC call. On PullStub, every successful pull moves ≥ 1 USDT to the team wallet (`payee()` = `0xb4E7…714D`, read on-chain). | `relayer.ts:26,176` |
| ERC-1271 contract signer | Closed. An ECDSA signature never recovers to a contract address, so it fails locally as `bad_signature`. | `relayer.ts:178-182` |
| EIP-7702-delegated payer, delegated **before** the request | Closed: `payer_has_code`. I confirmed in the verified `TetherTokenV2` source why this matters: `SignatureChecker.isValidSignatureNow` sends any signer with `extcodesize > 0` to `isValidSignature` (`util/SignatureChecker.sol:47-50,84-89`), and a delegated EOA's EXTCODESIZE is 23. | `relayer.ts:194,200` |
| Payer delegated, cancelled or emptied **after** the checks | **Open** (P1). `getCode` is only checked in the pre-check round, outside the lock. Nothing covers the gap between the last simulation inside the lock and inclusion. | `relayer.ts:191-204` vs `:212-215` |
| Gas burn under the cap | Closed. Simulations and the signed tx use the same `gas 400_000` and fees, so a burner fails the simulation and costs nothing. Worst case per sent tx: 400k × 10 gwei = 0.004 WBT plus the OP L1 data fee (about 9k wei for this fixed calldata; `maxFeePerGas` doesn't cap it). | `relayer.ts:20-25,186-188,223` |
| Replays and duplicates (one process) | Closed: the sent set (checked locally, at lock entry, and kept even when the send fails), `authorizationState`, and a re-simulation inside the lock after the previous sync send. | `relayer.ts:108-115,183,199,209,225` |
| Replays and duplicates (several instances) | **Open** (P2). The sent set and the lock live in one process. | `relayer.ts:107` `ponytail:` |
| Front-running with the same authorization sent straight to PullStub | Not a drain: the attacker's 1 USDT still goes to the team wallet, and they pay their own gas. | PullStub.sol:53-54 |
| `receive` vs `transfer` authorization | Correct. Only the `ReceiveWithAuthorization` typehash is accepted, with `to` = target. The token requires `to == msg.sender` (EIP3009.sol:130), so the signature can only be redeemed through PullStub. | `relayer.ts:36-41,177` |
| Expiry race | Closed for the normal path: at least 30 s left, checked at lock entry and again just before signing; 4 s sync wait; 8 s HTTP timeout; no retries. A tx stuck under a fee spike can still get mined after `validBefore` (P10, LOW). | `relayer.ts:86,208,221,74` |
| Gas-price spike | Closed: 503 `gas_price_cap` when `eth_gasPrice` > cap, and we never sign a fee above 10 gwei. | `relayer.ts:202` |
| Node-chosen fees | Closed. The tx is signed locally with `account.signTransaction` with every field set (chainId 1874, nonce, gas, both fees). There is no `eth_fillTransaction`, no `prepareTransactionRequest`, no `eth_estimateGas`. | `relayer.ts:223` |
| Failing RPC | Fails closed. A failed read or simulation → 502 with no txHash (nothing sent). A send error → 502 with txHash, and the sent set blocks a second send. A -32603 with non-hex data is not treated as a revert. The lock is held for at most two 8 s timeouts. | `relayer.ts:128-138,216-219,231-232` |
| Malicious RPC | Trusted by design (INFO). It can lie in `eth_call`, which makes us send txs that revert (at most 0.004 WBT each). It can return a fake receipt for our hash, which gives a false 200. It can withhold the broadcast. It can't change our fields or reach the key. | P11 |

**2. Can the lock, the sent set or the balance cache be abused?**
- **Lock:** a FIFO promise chain. `.then(run, run)` keeps it alive after a throw (tested at `:338`). It has no length cap and no per-payer limit, so anyone can fill the queue for free (P5). Each item holds the lock for one simulate‖nonce round (about 365 ms, up to 16 s on timeouts). Honest requests behind it fall under the 30 s margin and get 422 `expired`. No gas is lost.
- **Sent set:** grows by one entry (about 100 B) per transaction actually sent. Every send costs us gas or costs the payer ≥ 1 USDT, so its growth is bounded by real spend. It never prunes. Entries could be dropped after `validBefore` (INFO).
- **Balance cache:** `balances` only ever holds the relayer's own address. The value is at most 5 s old, the refresh runs every 3 s, every send clears it, and a read that overlaps a send is never cached (`sendCount`, `:89-97,234`). If refreshes keep failing, `/health` turns into 502 after 5 s instead of serving old data. Two small gaps:
  - `/health` doesn't say how old the value is.
  - On a cache miss (startup, the ≤ 3 s after a send, or while refreshes fail) there is no single-flight, so a burst of `/health` calls means one RPC call each (P7).

**3. Do error bodies, logs or files leak key material or the RPC URL?** No.
- Error bodies are `{error, code, txHash?}`. `error` is either a fixed string or viem's `shortMessage`. I checked the installed viem: `HttpRequestError`, `TimeoutError`, `RpcRequestError` and `SocketClosedError` all have fixed short messages, and the URL only appears in `metaMessages`, i.e. in `.message` (`_esm/errors/request.js:6-11,11,62,77`). Test `:426` covers it.
- The key exists only inside viem's account closures, and `/health` returns only the address.
- `relayerClient()` throws fixed messages for a missing, malformed or out-of-range key (`:67-73`; S9 closed; test `:643`).
- The one log line is `dev.ts:35`, which prints `e.message` for errors that escape the handler. Today nothing from viem's RPC layer can reach it. If something ever does, viem's `.message` contains `URL: <RPC_URL>`, and `getUrl` strips only `user:pass`, not an API key in the path (P8, LOW).
- Files: `apps/relayer/.env` holds one variable name (`RELAYER_PRIVATE_KEY`), is `-rw-------`, is git-ignored (`.gitignore:29`) and is not tracked. The tests spawn `dev.ts` with only `PORT` (`dev.test.ts:25`) and use `generatePrivateKey()`.

**4. Is the dev server's Host/413/415 handling sound?** Yes.
- **Host:** an exact allowlist, checked before routing and before reading the body (`dev.ts:9,16`). A missing Host, a DNS-rebinding Host, a wrong case or a wrong port all get 403. An absolute-form or odd request target never matches a route (404). Only `content-type` is forwarded into the `Request`.
- **413:** counted while streaming. In my probe, a 200 MB body to `/relay` got `413` after about 0.9 MB on the wire, the server closed the connection, and RSS stayed flat (123,072 → 124,288 KB).
- **415:** in `api/relay.ts:9-12`, so it applies on Vercel as well. `text/plain`, `text/plain; application/json`, form types and an empty type all get 415. A browser can only send `application/json` cross-origin after a preflight, `OPTIONS` gets 404, and there is no CORS header, so a page can't trigger a send. `no-cors` mode silently drops a JSON content type, and that request then gets 415.
- **INFO:** on 403 and 404, Node drains whatever body follows (`req._dump`). 2 GB streamed to `/nope` was read in full, RSS rose about 123 MB (transient, not linear) and the server kept answering. This costs local bandwidth and CPU only. Fix: `connection: close` on those two responses.

**5. What must land before a public deploy?** See "Before public deploy" (P1–P11) and NEEDS THE USER #2. In short:
- batch 003: revert breaker + daily budget + pause/alert, rate limits placed before the RPC round, a queue cap, the advisory lock + `rel_sent`;
- batch 004: target MerchantPay, take PullStub off the allowlist, the fee-vs-gas check at the 6 gwei cap;
- and keep the key out of Vercel until both pass.

## Batch 001 findings S1–S11

| ID | Status | Evidence |
|---|---|---|
| S1 localhost boundary not in code | OPEN, accepted as a human-enforced control (001 gate; human 22:01 decision 1; spec.md:69). No `.vercel` link and no `vercel.json` in any local checkout (`find` across `~/ethglobal*`). On Vercel, `api/relay.ts` still fails closed only because `relayerClient()` throws without a key. See NEEDS THE USER #2. | `api/relay.ts:7-14` |
| S2 ERC-1271 gas burn | CLOSED. ECDSA-only local check, `payer_has_code`, and a gas-capped simulation plus a 400k limit on the signed tx. What's left is the post-simulation race (P1). | `relayer.ts:182,200,187,223` |
| S3 replaced tx reported as success | CLOSED. `txHash = keccak256(signed)` before sending, and `receipt.transactionHash == txHash` is required. The human ruled 22:01 that only `/relay` sends from this key, so 001's NEEDS THE USER #3 is settled. | `relayer.ts:224,228` |
| S4 dust | CLOSED for PullStub (1 USDT minimum). The fee half is batch 004. | `relayer.ts:176` |
| S5 race, no lock, receipt wait | CLOSED in-process: FIFO lock, re-simulation inside it after the previous sync send, sent set, sync send. Several instances remain open (P2). | `relayer.ts:111-115,207-237` |
| S6 body buffered before the cap | CLOSED in `dev.ts` (streaming 413, probe above). On Vercel, `request.text()` still buffers up to the platform limit first (P9). | `dev.ts:20-26` |
| S7 CSRF / DNS rebinding | CLOSED: Host allowlist and JSON-only. | `dev.ts:9,16`, `api/relay.ts:9-12` |
| S8 whole root `.env` in the dev process | CLOSED: `node --env-file=.env dev.ts`, and the scoped file holds 1 variable. | `package.json:9` |
| S9 malformed key reaching stderr | CLOSED. | `relayer.ts:68-73`, test `:643` |
| S10 node picks gas and fees | CLOSED. Every field is set and the tx is signed locally. The L1 data fee is not capped (INFO, negligible). | `relayer.ts:20-25,223` |
| S11 PullStub has no sweep | Unchanged, INFO, owner claude-contracts. PullStub holds 0 USDT (`balanceOf` read on-chain). It goes away with batch 004. | PullStub.sol:31-56 |

## DONE (what I checked, and how)

- **Required grep** `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the diff's files: the 7 `apps/relayer` files without node_modules, `notes/phase-2-relayer.md`, and every `.md` in `.batches/002-P2-drain-guard/`. I masked 64-hex values in the output. Hits:
  - `src/relayer.ts:66,67,72` and `test/relayer.test.ts:645,646,650,653,654`: the env var *name* `RELAYER_PRIVATE_KEY` and fixed error text. Not secrets.
  - `test/relayer.test.ts:134`, `spec.md:51`, `round-1/test.md:26`: `0xcdcfacb6…2a25`, the public on-chain `DOMAIN_SEPARATOR` of USDT.
  - `test/relayer.test.ts:473`: `0xffffffff…4141n`, the public secp256k1 curve order `n`.
  - `build-relayer.md:24`, `batch.md:11`: `0x94598005…89bb`, a public tx hash. Blockscout: `ok success`, from the team wallet `0xb4E7…714D` to USDT.
  - `spec.md:11,59,63,69`, `build-relayer.md:9,21,29`, `round-1/2/3 test.md` row 7, `notes/phase-2-relayer.md:3`: env var names in prose.
  - No hit is a secret. A second scan (scratchpad `sec3/envscan.py`, 22 `.env` values of 8+ characters compared in memory) found **0** matches in all 182 files the diff touches, including the merged main files that still exist.
- `npx tsc --noEmit` → exit 0. `npm test` → `tests 36 · pass 36 · fail 0`, 0.90 s.
- **Token source** (verified `TetherTokenV2` `0x2642…26f7`, the EIP-1967 slot of `0xcedf…55a7` read with `cast storage`):
  - `isContract` via `extcodesize` → ERC-1271 (`SignatureChecker.sol:47-50,84-89`);
  - `to == msg.sender` (`EIP3009.sol:130`);
  - `block.timestamp > validAfter` and `< validBefore` (`:253,256`);
  - `cancelAuthorization` exists (`:177,195`);
  - `ECRecover` rejects high `s` and `v ∉ {27,28}` (`ECRecover.sol:57-63`). A malleated high-s signature passes our local recovery (noble doesn't enforce low-s on recovery) but fails the simulation as `would_revert`, so it costs one RPC round and no gas.
- **Chain facts** (Ankr, `reth/v2.3.0`): `eth_gasPrice` 5.001 gwei, `eth_maxPriorityFeePerGas` `0xf4240` (matches the constant tip), chain clock vs this host 0 s skew, PullStub `payee()` = team wallet and `usdt()` = prize USDT.
- **Reachability:** `lsof` → `node 5224 127.0.0.1:8787` only. No Vercel link anywhere.
- **Body probe** (scratchpad `sec3/bodyprobe.mjs`, `bodyprobe2.mjs`, my own key-less `dev.ts` on a random port): results in answer 4.
- **Code reading:**
  - every path to `sendRawTransactionSync` passes the local checks, the pre-check round, the 30 s re-check, the sent-set re-check, a passing simulation inside the lock, and the 30 s re-check again (`relayer.ts:243-256,207-227`);
  - `isRevert` can only misclassify toward "don't send";
  - `JSON.parse` runs after the 4 KB byte check, and the anchored, bounded regexes rule out ReDoS;
  - no PII is logged, there are no third-party calls besides the RPC, and no new dependencies (the `package.json` diff is the dev script only).

## OPEN: blocking for a localhost relayer

None.

## OPEN: before any public deploy (owner claude-relayer unless noted)

**P1, HIGH once public / LOW today: the chain can change after the last simulation, and we pay for the revert.** The in-lock round (`relayer.ts:212-215`) re-simulates but doesn't re-read `getCode`. Nothing covers the time from that simulation to inclusion. claude-review's R1/R2 (`~/ethglobal/research/relayer-drain-review-2026-11-06.md`) has the full cost analysis. I confirm the mechanism from the token source above.
- **Exploit:** the attacker's payer is a plain EOA at the pre-check round. While their request waits in the queue (P5 makes that wait as long as they like), they send a type-4 tx delegating the EOA to code whose `isValidSignature` returns the magic value when `block.number` is even and burns all its gas when it's odd.
  - The simulation inside the lock runs at `latest` and passes about half the time.
  - The tx is included at least one block later and burns about 400k gas, about 0.002 WBT at 5 gwei.
  - A failed try costs the attacker nothing, since the simulation rejects it.
  - Each round costs about 25–50k gas of 7702 authorizations (delegate, then clear). That's roughly 1:5 in the attacker's favour, so 0.498 WBT lasts about 250 rounds.
  - `cancelAuthorization` or moving the USDT away after the simulation also works, at about 1:1 on PullStub and worse on MerchantPay.
- **This also undercuts spec.md:69.** The case for keeping PullStub off the public relayer by a human-enforced rule was that "every pull must move ≥ 1 USDT", so it isn't an economic drain. A reverted pull moves nothing.
- **Fix:**
  - (a) A revert breaker in `send()`: ban `from` after one `reverted` (or `rpc_error` with txHash), and answer 503 to everyone after N reverts per hour. That's ARCHITECTURE §3 point 10 (alert on any failed tx), plus the daily WBT budget (point 8). Batch 003, with numbers approved by the human (NEEDS THE USER #3).
  - (b) Cheap now: add `client.getCode({ address: p.from })` to the in-lock `Promise.all` (no added latency). That shrinks the window from "the whole queue wait" to "simulation → inclusion", so the attacker needs sub-second timing instead of a parity trick.
  - (c) The gas limit per function: `pull` uses 94k, so 400k is 4× the real need. MerchantPay needs at least 335k (claude-review's correction).

**P2, HIGH if deployed as more than one instance: the sent set and the lock are per process.** `relayer.ts:107-115`. On Vercel, the same body POSTed to two instances means instance B reads nonce n+1 while A's tx is pending, simulates on `latest`, passes, and reverts on-chain. Fix: the Postgres advisory lock + `rel_sent` (human 00:45, R3; batch 003, needs Neon `DATABASE_URL`). Also set the Vercel `maxDuration` above the worst-case lock wait. Otherwise a function killed after the broadcast drops the txHash, and the client (spec Behaviour 4 says a 502 without txHash is safe to re-POST) could treat the platform's 504 the same way.

**P3, HIGH once public: PullStub must not be on a public allowlist.** It has no fee path (FR-REL-4) and no order binding, and P1 makes it a real drain. Fix: batch 004 switches `api/relay.ts:5` to MerchantPay and drops `pull`. Until then the human control holds (NEEDS THE USER #2). Owners: claude-relayer, claude-contracts (ABI in `packages/shared`).

**P4, MEDIUM: a free RPC-quota DoS.** Any random EOA can sign a valid `ReceiveWithAuthorization`. It passes every local check and triggers 5 RPC calls (`rpcChecks`), with no rate limit. The tester saw Ankr return 429 at about 28 calls/s from one IP, so about 6 requests/s from anyone takes `/relay` down for everyone (502 `rpc_error`, no gas spent). Fix: per-IP and per-payer rate limits **before** `rpcChecks` (batch 003). Optionally return the cheapest rejection first.

**P5, MEDIUM: the send queue has no cap** (claude-review R4). A wallet with 1 USDT can sign N authorizations with fresh nonces. All of them pass the pre-checks (the balance is checked, not reserved), all of them join the FIFO, and each holds the lock for about 365 ms (up to 16 s). Honest requests expire. Fix: at most one queued request per payer (a Set cleared in `send()`'s `finally`), a global queue cap with 503 `busy`, and rate limits.

**P6, MEDIUM (batch 004, MerchantPay): the cap is above break-even.** ARCHITECTURE §3 point 5 now says `maxFeePerGas ≤ 6 gwei` (human 00:45, commit `2cb9919`), but `relayer.ts:22` and spec.md:6,:81 still say 10 gwei. It isn't a security hole on PullStub, but the docs disagree (PIPELINE §2), so see NEEDS THE USER #1.

**P7, LOW: `/health` misses have no single-flight, and `/health` doesn't report the value's age.** `relayer.ts:90-98`. While refreshes fail (for example during a 429), every public `/health` call makes one more RPC call and keeps us rate-limited. Fix: cache the promise; optionally add `asOf`. Rate-limit `/health` in batch 003.

**P8, LOW: log hygiene.** `dev.ts:35` (and later Vercel's function logs) print `e.message`. If a viem error ever reaches it, that includes `URL: <RPC_URL>` with any API key in the path. Fix: log `shortMessage` or a fixed string, never `.message`. This matters once `RPC_URL` points at a keyed endpoint.

**P9, LOW: the Vercel edge.** `api/relay.ts:13` reads the whole body (up to Vercel's 4.5 MB) before the 4 KB check. Reject on `content-length > 4096` first. When the web app calls the relayer cross-origin, allowlist its exact origin for CORS, never `*`.

**P10, LOW: a stuck tx can expire unmined.** The pre-check compares `eth_gasPrice` with the cap itself. If the base fee rises above `maxFeePerGas` after that, the tx stays pending past the 4 s wait (502 with txHash). Later sends queue behind its nonce, and any of them mined after `validBefore` reverts at our cost. At 6 gwei over a 5 gwei base fee the headroom is only 20%. Fix: require `gasPrice ≤ 0.8 × cap` in the pre-check, and count a 502 with txHash in the P1 breaker.

**P11, INFO: the RPC is trusted.** A malicious RPC can fake a success receipt or a passing simulation. For batch 004, the merchant should release goods or fire a webhook only on a `Paid` event that an independent read confirms (the indexer or a second RPC), not on the relayer's 200 alone. Owners: claude-relayer, claude-frontend.

**INFO (PullStub only, frontend):** after a 502 with txHash, the old authorization stays valid until its `validBefore`. The RPC has seen it in `eth_call` and the raw tx. If the client re-signs before then and both land, the payer pays twice (to the team wallet). MerchantPay's order binding prevents this. For PullStub, re-sign only after `validBefore` has passed. Owner claude-frontend.

## FOLLOW-UP (fast mode §3a.1, owner claude-relayer, next batch)

- P1(b): one line, `getCode` inside the in-lock `Promise.all`, plus a test where the fake node grows code between the two rounds and nothing is sent.
- `connection: close` on the `dev.ts` 403 and 404 responses (`dev.ts:16,18`), so Node doesn't drain huge bodies.
- Prune sent-set entries after `validBefore + 60 s`, since an expired authorization can never land.
- Optional: a local low-s check in `localChecks` saves one RPC round per malleated signature.
- The tester's LOW test gaps (`unref`, refresh `.catch`, refresh start, M6) stand. The `.catch` matters for security: without it, one failing refresh crashes the dev process.

## NEEDS THE USER (PIPELINE.md §11)

1. **The gas cap disagrees between docs (PIPELINE §2).** ARCHITECTURE §3 point 5 says ≤ 6 gwei (your 00:45 decision). The code and the spec still use 10 gwei (your 22:53 approval). claude-review's plan puts the 6 gwei cap in batch 004. Either confirm that, so claude-relayer records it in batch.md, or ask for the one-constant change now. On the PullStub path, 10 gwei is safe either way.
2. **A pass here doesn't make the relayer safe to deploy.** Decision 22:01(1) reads "no `RELAYER_PRIVATE_KEY` in any Vercel project until the Phase 2 drain guard passes". This batch is only part of that guard. P1, P2, P4 and P5 remain, and PullStub has no fee (P3). Please keep the key out of Vercel until batch 003 (breaker/budget, rate limits, pause, advisory lock) **and** batch 004 (MerchantPay target, PullStub off the allowlist) both pass. I found no Vercel link in any local checkout, but I can't see the Vercel dashboard, so please confirm no project env holds the key.
3. **Breaker numbers for batch 003** are a relayer limit, so they need your approval. The proposal: ban a payer after 1 reverted send, and pause all relaying after 3 reverts per hour, with an alert.
4. **Standing flags:** the relayer limits in this batch are gas 400k, maxFee 10 gwei, tip 0.001 gwei, window ≤ 15 min, ≥ 30 s left, ≥ 1 USDT, `/health` ≤ 5 s old with a 3 s refresh, and no RPC retries. The key file is `apps/relayer/.env`. The live gate pull still needs your OK. On the builder's fresh in-memory payer: it's fine from a security view if the key is never written to disk or logs, the payer holds exactly 1 USDT and 0 WBT, and the tx is checked with `cast tx` for `0x61a80` / `0x2540be400` / `0xf4240`.

Scratch files (no secrets): `/private/tmp/claude-501/-Users-vg890-ethglobal-relayer/8148ef7e-ac03-4282-84ed-0cbdc7d30d0f/scratchpad/sec3/` (`envscan.py`, `bodyprobe.mjs`, `bodyprobe2.mjs`, `dl/impl.json` = the verified TetherTokenV2 source from Blockscout).
