STATUS: READY
# Build — Part A (web webhook outbox) · builder whiteflow-ef · round 1

## What changed
| File | Change |
|---|---|
| `apps/web/lib/server/webhooks.ts` | New `enqueueEventOnce(onceKey, merchant, type, data, now, eventId)`: ONE SQL statement (data-modifying CTE) inserts the `app_gw_events` key and one pending delivery per endpoint; delivery id = `dlv_` + md5(webhook id ‖ ':' ‖ event id)[0:24] with `ON CONFLICT (id) DO NOTHING`; deliveries due only after the 60 s lease window. New shared lease: `claimLease` (`leased_until`), `attemptLeased` (fenced outcome UPDATE `WHERE leased_until = <our lease>`, releases the lease, never downgrades `succeeded`), `attemptDelivery` = claim + attempt, **409** while another attempt holds the lease. `dispatchDue` claims via `leased_until` (+ `FOR UPDATE SKIP LOCKED`) and no longer rewrites `next_attempt_at`. Inline-attempt loop factored into `attemptInline` (same error handling/logging as before). `enqueueEvent`/`deliver`/`sendTestEvent` semantics unchanged. |
| `apps/web/lib/server/events.ts` | `sendOnce` = cheap key pre-check (F4) → `enqueueEventOnce`. The insert-key-then-enqueue-then-delete-on-error sequence is gone. |
| `apps/web/db/051_webhook_outbox.sql` | `ALTER TABLE app_gw_deliveries ADD COLUMN IF NOT EXISTS leased_until BIGINT` (additive, re-run safe, splitter-compatible). Apply: `node --env-file=../../.env db/migrate.mjs` from apps/web (existing runner). Rollback: deploy pre-031 code (ignores the column), optionally `DROP COLUMN IF EXISTS leased_until`. |
| `apps/web/test/gw-outbox.test.mjs` | New, 8 tests (A1/A6 crash, A1 write failure, A2, A3, A4×2, A5, A8). |
| `apps/web/test/gw-events.test.mjs` | Recorder moved to the new seam `enqueueEventOnce`, keeping its contract (key written only with a successful enqueue). Assertions unchanged. |

## Why this fixes the defect
Before: `INSERT app_gw_events` (statement 1) → build data → insert deliveries (statements 2..n) → on a *thrown* error, delete the key. A killed process between 1 and 2 left the key with no deliveries; every later re-announce returned early → the webhook was never sent (HIGH, events.ts:91). Now the key and deliveries are one atomic statement. Reproduced RED first: `gw-outbox` crash test failed on the old code with `keys=["paid:sess_out"] deliveries=0`.

## Commands run (Node v24.14.0, Windows; real output)
RED (old code): `node --experimental-test-module-mocks --test test/gw-outbox.test.mjs` → `ℹ pass 3 · ℹ fail 4` (A1/A6 crash, A3, A4 lease/409, A5 failed; the failure text above).
GREEN (new code), per file:
```
gw-outbox            rc=0 pass=7 fail=0
gw-events            rc=0 pass=10 fail=0   (baseline 10/0)
gw-webhooks          rc=0 pass=21 fail=0   (baseline 21/0)
gw-tester-webhooks   rc=0 pass=3 fail=0    (baseline 3/0)
gw-dispatch          rc=0 pass=6 fail=0    (baseline 6/0)
gw-sdk-compat        rc=0 pass=3 fail=0    (baseline 3/0)
dev-screens          rc=0 pass=6 fail=0    (baseline 6/0)
docs-endpoints       rc=0 pass=9 fail=0    (baseline 9/0)
docs-limits          rc=0 pass=13 fail=0   (baseline 13/0)
gw-refunds           rc=0 pass=18 fail=0   (baseline 18/0)
refund-sync          rc=0 pass=8 fail=0    (baseline 8/0)
voucher-pay          rc=0 pass=25 fail=0   (baseline 25/0)
checkout-api         rc=0 pass=32 fail=0   (baseline 32/0)
invoice-pay          rc=0 pass=24 fail=0   (baseline 24/0)
```
`npx tsc --noEmit` → exit 0 · `npm run lint` → exit 0. Full per-file suite + `npm run build`: see round-1/ci.md.

## Round-1 review fixes (independent 3-lens review + adversarial verify; see round-1/review-security.md)
- R1 (MEDIUM, confirmed by all three lenses): the crash test's `/app_gw_events/` matched the new read-only pre-check first, so it never exercised atomicity or A6. Fixed: crash on `/INSERT INTO app_gw_events/` (the old key insert and the new CTE both match; the pre-check doesn't), assert the exact post-commit state (marker + 1 pending delivery, `leased_until` NULL, due at now+60 s, 0 calls), then `dispatchDue(now+59 999)=0`, `dispatchDue(now+60 000)=1` with the stable event id, re-announce sends nothing. **Proven to be a real guard:** with the pre-031 `sendOnce` temporarily restored the test fails (`deliveries=0`); with the fix it passes; `events.ts` restored byte-identical (`cmp`).
- R2 (LOW): deploy order — see Rollout below.
- Hardening (reviewers rated not-a-defect, cheap): lease-release test now asserts `leased_until IS NULL` after the inline attempt; new A8 test re-applies 051 and checks exactly one column. gw-outbox now **8/8**.

## Round-2 fixes (whiteflow-b7 read-only cross-review of Part A)
- M1 (MEDIUM): DNS lookup had no deadline (only fetch had 5 s) → an attempt could outlive its 60 s lease and be POSTed concurrently by another instance. Fixed: `assertPublicUrl` races `dns.lookup` against a 3 s deadline; dispatch runs ≤ 10 attempts at once over ≤ 30 claims (≈ 24 s worst case < 60 s lease). Test M1: hanging DNS → attempt ends in ~3 s, recorded as a failed attempt, lease released.
- L1 (LOW): `dispatchDue` used `Promise.all` → one DB error rejected the cron call mid-batch. Fixed: bounded worker pool, each attempt's error logged by name only. Test L1 (injected outcome-write failure on one delivery; the other is still recorded). RED for L1 not separately observed (the RED run was cut off after the hanging M1 test); reasoning: the old `Promise.all` rejects on the injected error.
- L2 (LOW): the inline first attempt could re-send a delivery dispatch had already delivered if the instance stalled > 60 s. Fixed: inline claim requires `status='pending' AND attempts=0`. Test L2 (instance frozen after the CTE; dispatch delivers; the woken instance sends nothing). RED observed.
- T1: new deterministic test of the CTE's ON CONFLICT path (two enqueues past the pre-check; loser queues nothing; winner's body delivered).
- I1: see Rollout step 3.
gw-outbox now **12/12**; gw-events 10/10, gw-webhooks 21/21, gw-tester-webhooks 3/3, gw-dispatch 6/6, gw-sdk-compat 3/3, dev-screens 6/6, docs-endpoints 9/9, docs-limits 13/13, gw-refunds 18/18, refund-sync 8/8, voucher-pay 25/25; `tsc` 0, lint 0.

## Round-3 fixes (owner decisions at the human gate, spec "Round 3")
- **A9 — DNS deadline deferred, not counted.** `assertPublicUrl` throws a distinct `DnsTimeoutError` ("That host's DNS didn't answer in time. Try again in a moment.") vs "We couldn't find that host" for NXDOMAIN/other errors. `send()` returns `"dns_timeout"`; `attemptLeased` then releases the lease (fenced), leaves `attempts`/`status`/`response_status` unchanged and reschedules with an age-based backoff (1–15 min) — for 2 h after the delivery was queued; after that a DNS timeout counts like any failure, so a permanently broken host still ends `failed`. A delivered (`succeeded`) row is never deferred. Engineering values (testnet), documented in code.
- **A10 — cooldown message.** `relay.ts`: relayer `429` + `code: "payer_cooldown"` (+ `retry_after_s`) → `{ok:false, status:429, message: cooldownMessage(...)}`: "This wallet is paused for about N minutes after several failed payment attempts. Nothing was charged; please try again then." (no codes shown; not `unknown`, so nothing goes pending). Same mapping on the investor funding path (`lib/server/capital-fund.ts` → HttpError 429). Other 429s stay "busy". The pay routes already pass status/message through and release the hold for non-`unknown` refusals.
- Tests (RED observed first for the deferral, the create-message, and both cooldown tests): gw-outbox **15/15** (M1 now expects attempts 0 + later retry; new: NXDOMAIN still counts; bounded window; create-message), relay-cooldown **2/2** (new), capital-fund 10/10 (one new case in the refusal table), relay-auth 5/5, gw-webhooks 21/21, gw-dispatch 6/6, gw-events 10/10, gw-tester-webhooks 3/3, dev-screens 6/6, docs-endpoints 9/9, docs-limits 13/13, checkout-api 32/32, invoice-pay 24/24, voucher-pay 25/25, capital-routes 3/3; `tsc` 0; lint 0.
- The round-2 LOW (DNS threadpool trade-off) is resolved by A9: a hanging-DNS merchant can delay others' deliveries (retried a minute later) but can no longer exhaust their retries.

## Round-4 (owner supervision prompt + staged plan, Stage 2)
- **A13** concurrency-critical webhook SQL exported and used by the code: `SQL_ENQUEUE_ONCE`, `SQL_CLAIM_LEASE`, `SQL_CLAIM_FIRST_ATTEMPT`, `SQL_OUTCOME`, `SQL_DEFER`, `SQL_DISPATCH_CLAIM` (for the real-Postgres harness, Part D).
- **A11** connection isolation: `vetAddresses()` resolves through an injectable `WebhookNet`; production = per-attempt c-ares `dns.Resolver({timeout 1 s, tries 2})` cancelled via AbortSignal at the 3 s deadline (no getaddrinfo threadpool), and `pinnedPost()` = `https.request` whose `lookup` returns only the vetted address (SNI/Host = hostname, `agent:false`, no redirects, 5 s hard timeout). Fair dispatch: `SQL_DISPATCH_CLAIM` takes ≤ 3 due deliveries per destination per run (window function; outer re-check replaces SKIP LOCKED). `test/gw-helpers.mjs` installs a test net over each file's dns.lookup/fetch mocks from `setupDb()` (lazily, after module mocks; a first eager version broke gw-dispatch's `after()` mock — caught and fixed).
- **A12** relayer `422 replay` → `ALREADY_SUBMITTED` ("already submitted. Don't pay again yet…"), still refused/no lock (existing anti-lockout test unchanged), chain lookup still runs.
- **A14** relayer 502/unknown `txHash` (valid hashes only) kept on the result and persisted with the pending attempt (checkout `pending.txHash`, invoice `attempt.pending.txHash`); compare-and-clear includes it.
- Tests: gw-isolation **6/6** (pinned connect to a local listener for an unresolvable `.invalid` host; resolver cancel on abort; ETIMEOUT→DnsTimeoutError vs ENOTFOUND; vetted address reaches the POST and a rebinding to a private IP is refused before connecting; fairness 3+1 of 10+1; hanging DNS destination vs healthy one in one run); pending-ref **3/3**; relay-cooldown 3/3; gw-outbox 15/15; gw-dispatch 6/6; gw-webhooks 21/21; gw-events 10/10; dev-screens 6/6; docs-endpoints 9/9; gw-tester-webhooks 3/3; checkout-api 32/32; checkout-edges 22/22; invoice-pay 24/24; voucher-pay 25/25; sessions-db 13/13; sessions-v2 19/19; settle 2/2; relay-auth 5/5; payments-api 7/7; gateway-server 6/6; capital-fund 10/10; `tsc` 0; lint 0.
- Open: docs-limits passes 13/13 but the process no longer exits (open handle) since the concurrent Part C rate-limit edits — handed to whiteflow-fb. Not verified here: the real `pinnedPost` TLS success path against a real public HTTPS endpoint (no outbound test target; covered for routing only).

## Round-4b (owner Stage-2 prompt, items 6–7)
- **Pinned HTTPS, CONTROLLED LOCAL FIXTURE** (`test/pinned-https.test.mjs`, 4/4, exit 0; openssl-generated throwaway CA per run, 127.0.0.1; NOT an outbound/deployed smoke test): socket goes to the vetted address for an unresolvable hostname; TLS validates the intended hostname via the fixture CA passed for that request only (`pinnedPost(..., {ca})`; production passes nothing → system trust store; verification never disabled); SNI = hostname, Host = host:port; wrong-hostname and self-signed certs rejected with no request sent; without the fixture CA even the right cert is refused; 302 returned as a status, not followed; a never-answering destination times out and its socket closes while a healthy one completes first.
- **Unknown-payment recovery** (`test/unknown-recovery.test.mjs`, 7/7, exit 0; chain reads mocked): lost first response (502 + txHash) → 504 "Don't pay again", reference stored; retry → 409 STILL_PENDING with **one** relay call; refresh → status `pending` + `pendingTxHash` (new field; `txHash` stays null until paid); no relayer answer and relayed-200-but-chain-read-failed both stay pending, never "nothing charged" (the latter now also keeps the relayer's txHash — fixed in `recordRelayed`); only a relayer 503 before signing says "Nothing was charged" (true by the relayer's fail-closed contract); two simultaneous submissions → one relay; chain shows the sale → `paid`; expired approval + nothing on chain → `open`, new payment succeeds.
- Limits (Stage 4, not claimed here): V1 MerchantPay accepts any amount ≥ 1 USDT for an orderRef, so a direct on-chain payment at the wrong price can still consume a checkout reference (W0 MEDIUM); the customer-facing page copy was not re-screenshotted.

## Rollout (R2)
1. Apply `051_webhook_outbox.sql` to the database **before** deploying this web build (`node --env-file=../../.env db/migrate.mjs` from apps/web). Check: `SELECT column_name FROM information_schema.columns WHERE table_name='app_gw_deliveries' AND column_name='leased_until'` returns one row. Code deployed without the column records events and deliveries but every attempt fails on `leased_until` (claim UPDATE) until the migration runs.
2. Deploy. Pre-031 instances still draining during cutover use `next_attempt_at` as their lease; the overlap window is the deploy duration.
3. (I1) Events already lost to the pre-031 bug are not repaired automatically (their marker exists, so re-announces skip). Optional one-off check once DB access exists: for each `app_gw_events` key whose merchant has an endpoint, look for a delivery with `event_id = eventIdFor(key)` (sha256-derived, so a small script, not plain SQL); re-queue any missing ones with the same event id.

## Open / follow-up (not in this batch)
- **Round-2 review LOW (introduced by the M1 fix, trade-off for the human):** the 3 s DNS deadline stops *waiting* but doesn't cancel `getaddrinfo`; abandoned lookups keep libuv's 4 threadpool threads busy. If one merchant's endpoint DNS hangs (outage, or a merchant who controls its DNS) and it has ≥ 4 due deliveries in a dispatch batch, other merchants' healthy lookups can time out in the queue and be recorded as failed attempts (retried 1/5/30 min; final `failed` after 4, manual replay still possible). Round 1's risk was instead a concurrent duplicate POST (same event id, receiver-dedupable). Candidate fixes (next W4 batch, FR-OPS-6): don't count a DNS-deadline expiry as an attempt (release the lease, push `next_attempt_at`, with an age cap); or a c-ares `dns.Resolver({timeout, tries})` pre-check; or raise `UV_THREADPOOL_SIZE`; separate "DNS timed out, try again" message on create.
- Comment drift fixed after round 2 (no behaviour change): `dispatchDue` docstring (30, not 50), `attemptInline` docstring.
- Full transactional outbox committed in the same transaction as the payment/refund state (FR-OPS-6, needs SRS v3.0).
- DNS-rebinding window remains (fetch re-resolves; needs a pinned dispatcher) — pre-existing MEDIUM.
- No frequent scheduler is configured (`vercel.json` has no cron; Hobby allows daily only). Retries run from `dispatchSoon` after dashboard reads and from `POST /api/v1/webhooks/dispatch` when something calls it. **NEEDS THE USER:** hosting plan / external cron choice.
- Local test-command portability: `node --test test/` (directory form) fails on Node 24.14; CI pins Node 26.
