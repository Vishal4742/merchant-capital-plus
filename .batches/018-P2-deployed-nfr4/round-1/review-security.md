VERDICT: PASS

# Security review: 018-P2-deployed-nfr4, round 1 (phase mode, Money: yes)

Reviewer: reviewer-security (Opus). Scope: `git diff e5f56a5~1..HEAD -- apps/relayer` (be5e748, e5f56a5, c585ab4, c412a6f) plus the timings test from be5e748, against spec.md and its Step 2 addendum. I read the code only: no deployed URLs, no transactions, no `.env`.

Local evidence (apps/relayer): `npm test` gave `tests 56, pass 56, fail 0`. `npx tsc --noEmit` exited 0.

No HIGH or CRITICAL findings. Three LOW items go under FOLLOW-UP below (PIPELINE §3a.1).

## What I checked and found clean

**1. The timings and the log line leak nothing.** `timings` (relayer.ts:472) is `{cold: boolean, checks, queue, presend, send, receipt, total: integer ms}`. The `console.info` (relayer.ts:473) adds only the txHash, which is public on-chain. It carries no payer address, no key, no `RELAY_API_SECRET`, no RPC URL and no error text. Both appear only on a 200, and only after `authorized()` passed. The web client copies `txHash`, `blockNumber` and `paymentId` and drops everything else (apps/web/lib/relay.ts:77-79), so `timings` never reaches a browser. `queue` shows our own web server how long other sales held the lock: harmless, and dropped anyway.

**2. No timing side channel into the drain guard.** An anonymous POST gets the 401 at api/relay.ts:14 before `relay()` runs. The compare is a SHA-256 digest compare with `timingSafeEqual` (api/relay.ts:6-10), so its timing doesn't depend on the secret, and none of the guard's code runs. Rejects carry no `timings`. Signing time is folded into `presend` together with an RPC round, at ms granularity, so there is no key-timing signal. (/health does now expose live guard state; see F2.)

**3. Auth in the shared function.**
- `GET` (api/relay.ts:24-26) only calls `health(relayerClient())`. It can never reach `relay()`.
- `POST` still checks the secret first (line 14), then the content type (16-19), then calls `relay()` (20).
- In GET, the key is used only to derive the account inside `relayerClient()` (relayer.ts:86-101). `health()` reads `client.account.address` and calls `getBalance`. It never signs.
- If the key is missing or bad, the error messages are constants (relayer.ts:89, 94).
- The deleted api/health.ts loaded the same module and the same `RELAYER_PRIVATE_KEY`. One function now holds the key instead of two, so key exposure is unchanged or slightly smaller.
- Method crossover: `POST /health` now relays a sale and `GET /relay` returns health. See F3. It is not a bypass.

**4. Fluid concurrency: the in-process assumptions hold.**
- `serialized` (relayer.ts:182-186) is a module-level promise chain on one JS thread, so concurrent requests in one instance queue FIFO.
- Inside the lock, `send()` checks `tooLate` and the sent set again (399-400) and runs `ledgerChecks` again (413). The lock is held from those checks through `sentAuthorizations.add` (419) and `recordSend` (427/431/438/444), so a concurrent re-POST of the same authorization gets REPLAY. Two sales can't both pass the budget or breaker check.
- Balance cache: the `sendCount` guard (117-119) still keeps a read that overlaps a send out of the cache. Concurrency only adds duplicate reads (F1).
- `relays++` (458) and the `liveClient` setup (86-101) are synchronous, so there's no race: exactly one `cold: true` per instance and one client.
- The stopwatch is per request (380-392) and immutable per lap.
- Fluid packs requests into fewer instances, which helps the per-process guard. The spec says Fluid is already the default, so pinning it changes nothing at runtime. Separate instances still have separate locks, sent sets and ledgers, as before. Postgres lock / rel_sent is out of scope (spec line 37).

**5. The 250 ms poll and the RPC budget.** Warm iad1 → Ankr RTT is about 100-140 ms (batch.md 09:35), so one poll cycle takes about 370 ms instead of 420. For the deployed 1,374 ms receipt wait that is about one extra `eth_getTransactionReceipt` per sale. The worst case over `receiptTimeoutMs` = 8 s is about 22 calls instead of 19. For comparison, the 3 s background balance refresh costs about 20 calls a minute per live instance (relayer.ts:25, 124-128), and sends are capped at 10/h per payer and 200/h per merchant. The poll change is negligible. No finding. The poll's abort-on-first-error behaviour was already there before this batch (F1).

**6. dev.ts.** It now imports both handlers from api/relay.ts (dev.ts:4). The routes are unchanged (`POST /relay`, `GET /health`, dev.ts:9-12). The server is still bound to 127.0.0.1 with the Host allowlist (dev.ts:8, 15, 37), still forwards only `content-type` and `x-relay-secret` (28), and POST still goes through the secret check. Nothing changes for security. The header comment on line 2 is stale ("rewrites added with the deploy batch"), not a security issue. dev.ts is outside `api/`, so it isn't deployed as a function.

**7. vercel.json.** `fluid: true` (line 6), `maxDuration: 60` (9), and `/health` → `/api/relay` (18-19). No headers, CORS or secrets. Nothing in the repo still references `api/health` (grep: no hits).

**8. Secret scan.** I ran `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` on the six files in the diff, with 64-hex values masked in the output. It found 12 hits and none is a secret:
- api/relay.ts:4, 8: the env var name `RELAY_API_SECRET`
- src/relayer.ts:88, 89, 94: the env var name `RELAYER_PRIVATE_KEY` and its constant error strings
- test/relayer.test.ts:231: a USDT EIP-712 domain separator (a public value)
- test/relayer.test.ts:588: `SECP256K1_N`, the curve order (a public constant)
- test/relayer.test.ts:763, 764, 768, 771, 772: env var save/restore in the bad-key test

The lines this batch adds have 0 hits (both diffs).

## FOLLOW-UP (non-blocking)

### F1 LOW: public /health now runs in the signing instance, and a cache miss is not single-flight
- **Where:** relayer.ts:113-121 (`wbtBalance`), 446-448 (each send clears the cache), 364-375 (`ownReceipt` rethrows any error except NotFound); vercel.json:18-19.
- **Scenario:** Each sale deletes the cached balance. Until the next `getBalance` returns (about 120 ms warm), every anonymous `GET /health` arriving in a separate event-loop tick starts its own `getBalance` on the same batched transport and the same Ankr per-IP quota the sale uses. The same happens at every 5 s TTL expiry. A flood of a few hundred requests per second turns into tens of RPC calls per second. If Ankr answers a sale's receipt poll with a 429 or an error, `ownReceipt` throws on the first one (367-369). The sale then returns `502 rpc_error` with its txHash, and the web marks a sale that will be mined as "couldn't confirm" (apps/web/lib/relay.ts:90).
- **Impact:** no funds at risk (the sent set holds, and the web settles from the chain). It's a cheap anonymous way to degrade NFR-4 and the PAID screen. Before this batch the same reads ran in a separate function, so the change is the shared instance and transport, not a new attack.
- **Fix:** make `wbtBalance` single-flight the way `relayFee` already is (one shared promise per miss, relayer.ts:168-176). Optionally, in `ownReceipt`, treat a transient RPC error like NotFound until the deadline.
- **Owner:** claude-relayer.

### F2 LOW: /health now shows the live drain-guard state of the instance that signs
- **Where:** relayer.ts:484-487 (`gasSpentToday`, `budgetLeft` from `ledgerOf`); api/relay.ts:24-26.
- **Scenario:** The old separate /health function always reported a spend of 0. Now an anonymous caller sees the real spend of the instance that signs, so a griefer can watch `budgetLeft` fall toward `budget_exhausted`. Whether a request hits or misses the cache also shows whether a send happened in the last few seconds.
- **Impact:** small. The relayer address is public, so its daily gas spend and send times can already be read from chain (1 s blocks). ARCHITECTURE §3 makes /health public for the merchant dashboard on purpose. No change is needed for the demo.
- **Fix, if wanted later:** return `gasSpentToday`/`budgetLeft` only when `x-relay-secret` is present. The web's `relayerHealth` already runs on the server (apps/web/lib/relay.ts:103-105), so it could send the secret.
- **Owner:** claude-relayer, with a one-line change for claude-frontend.

### F3 LOW: method and path crossover from the rewrite
- **Where:** vercel.json:14-19; api/relay.ts:13, 24.
- **Scenario:** `POST /health` (and `POST /api/relay`) with the secret relays a sale, and `GET /relay` and `GET /api/relay` return health. Auth is unchanged, so this is not a bypass. But a future Vercel Firewall or rate-limit rule written for `POST /relay` alone would be skipped by `POST /health`.
- **Fix:** none now. If a path rule is ever added, match `/relay`, `/health` and `/api/relay` together, or scope it to the function.
- **Owner:** claude-relayer.

### F4 LOW: the lock wait has no ceiling below `maxDuration`
- **Where:** relayer.ts:397-449 (lock held through simulate‖nonce, send and the receipt poll); vercel.json:9 (`maxDuration` 60); apps/web/lib/relay.ts:69 (35 s client timeout).
- **Scenario:** With Fluid packing concurrent sales into one instance, a sale queued behind one whose RPC hangs can wait about 32 s: 8 s simulate‖nonce, 8 s send, 8 s polling, plus one 8 s in-flight poll. It can then still sign and send, because `tooLate` only checks `validBefore`. By then the web has given up at 35 s and shows "couldn't confirm". Vercel may also cut the invocation at 60 s after the broadcast and before `recordSend`, so this instance's ledger misses that spend.
- **Impact:** money-safe (the EIP-3009 nonce is single-use, and the web settles from the chain), and Fluid was already the default. It's a UX gap plus a small hole in the ledger count.
- **Fix:** in `send()`, before signing, return 503 busy (nothing sent) when the request has been open longer than about 20 s. `clock` already holds the start time.
- **Owner:** claude-relayer.

### Note for claude-frontend (batch 020, not in this diff)
claude-frontend's agentbus message (09:47) says the web now fires `GET <RELAYER_URL>/health` from `after()` whenever /checkout, /l, /p or /pay opens, with a 3 s cap, no header and no await. Not sending the header is right. Add a debounce, at most one ping per ~3 s per web instance: the cache and the warm socket last longer than that anyway. Without it, every anonymous page open becomes a relayer request. The web already handles Vercel's burst protection in front of the relayer (403 with `x-vercel-mitigated`, apps/web/lib/relay.ts:84-86). If that protection trips on the web's own egress, POST /relay from the same egress could also get 403, and sales would answer BUSY. LOW. Owner: claude-frontend.
