# Spec: 006-P2-neon-limits

## Requirements (cite docs/SRS.md IDs)
- **FR-REL-5**: rate limits per payer and per merchant (per-IP limiting moves to the web app, human 02:44) and a **daily WBT budget**, 503 when exhausted.
- **FR-REL-6**: `/health` reports `gasSpentToday`, `budgetLeft` and `paused` from storage (today `null` / `false`).
- **FR-REL-1/2/3** unchanged; **AT-10** stays green.
- ARCHITECTURE §3 points **7** (rate limits in SQL), **8** (daily budget, 503), **10** (pause switch + alert on any failed tx), **12** (breaker: ban a payer after 1 mined revert; 503 to all `/relay` after 3 mined reverts in an hour, human 02:44), **13** (`/relay` requires the web server's `RELAY_API_SECRET` header), and "serialized sends (Postgres advisory lock)" — drain review **R3** (human 00:45: Postgres lock + `rel_sent` before any public URL), **R1/R2** (breaker), **R4** (one queued request per payer), **R6** (single-flight balance read).
- **NFR-3**: the relayer reads `RELAYER_PRIVATE_KEY`, `RPC_URL`, `PORT`, `DATABASE_URL`, `RELAY_API_SECRET` and nothing else; none is ever printed or returned.
- **NFR-14**: the storage check runs **in parallel** with the RPC pre-check round, so a rejection still costs one round trip.

## Behaviour (revised 03:30 after the plan review; human numbers 03:09)
1. **Auth** (before parsing): `POST /relay` needs `x-relay-secret`; compared as sha256 digests with `timingSafeEqual` (equal lengths, so a wrong-length secret is 401, not 500); missing or wrong → **401** `unauthorized`; `RELAY_API_SECRET` unset → every `/relay` is 401 (fail closed). `dev.ts` forwards `x-relay-secret`. `/health` stays open.
2. Parse + free checks as in batches 002/007.
3. **One round, in parallel**: the RPC pre-checks **and** one SQL read (`verdict`) over `rel_sent` / `rel_settings`, judged before the RPC results:
   - `paused` → **503** `paused` (`rel_settings` row, set by the operator in the Neon console)
   - mined reverts in the last hour ≥ 3 → **503** `breaker_open` (rolling hour)
   - this payer has a mined revert → **422** `payer_banned`
   - `spentToday + capFee > 0.1 WBT` (UTC day; capFee = 400k × 6 gwei) → **503** `budget_exhausted`
   - this payer's **sends** in the last hour ≥ 10, or this sale merchant's ≥ 200 → **429** `rate_limited` (counts `rel_sent` rows, not attempts: attempts are limited per IP by the web app, which is the only caller once the secret is required; invoices count per payer only)
   - a storage failure → **502** `storage_error` with a fixed message (pg errors name the host/user)
4. **Send lock**: the in-process `serialized()` stays in front (one lock client per instance), then a transaction on one pooled client: `SET LOCAL lock_timeout = '10s'` (→ 503 `busy`), `SET LOCAL idle_in_transaction_session_timeout = '30s'`, `pg_advisory_xact_lock(<constant>)`. Inside it, **re-run the same `verdict` read plus the `rel_sent` check for (payer, nonce)**, then re-simulate ‖ nonce as before. Before broadcasting, insert the `rel_sent` row (`pending`, `fee_wei = capFee`) on a separate autocommit query; **if that insert fails, nothing is broadcast** (502 `storage_error`). After the receipt, update `success` / `reverted` with the real fee; a mined revert logs `ALERT reverted <txHash> payer <from>`. Pool: `max: 4`, `connectionTimeoutMillis: 3000`.
5. **`/health`**: `gasSpentToday`, `budgetLeft`, `paused` from one SQL read (served from the 5 s cache like the balance).
6. Schema `apps/relayer/schema.sql` (idempotent), applied when the pool starts (no separate migrate script): `rel_sent(tx_hash pk, payer, nonce, target, merchant, status, fee_wei numeric, created_at, unique(payer, nonce))`, `rel_settings(key pk, value)`. Every query takes a schema name, so tests run in a throwaway schema.

## Acceptance criteria
- [ ] `npx tsc --noEmit && npm test` pass; tests first.
- [ ] One verdict test suite run against **both** stores (memory always; Postgres when `DATABASE_URL` is set, in a random throwaway schema dropped afterwards, so test reverts never touch the live breaker or budget): every Behaviour 3 code; the in-lock re-check (5 queued, the first 3 revert → requests 4–5 get `breaker_open`, nothing sent); budget `spent + cap > budget`; a failed `rel_sent` insert → no broadcast; a duplicate (payer, nonce) → `replay`.
- [ ] Lock test on the Postgres store with `pool.max + 2` concurrent sends: no overlap, no deadlock.
- [ ] 401 for no / wrong / wrong-length secret, nothing else runs; `dev.ts` forwards the header.
- [ ] Carry-overs: tests for the refresh `unref()` / `.catch` / start in `relayerClient()`; log refresh failures (no URL); `connection: close` on dev 403/404.
- [ ] Live, no tx: 401 without the secret; with it, a local and an RPC reject; `/health` shows `gasSpentToday` / `budgetLeft` from Neon; reject p95 recorded.
- [ ] NFR-3: env names exactly `DATABASE_URL`, `PORT`, `RELAY_API_SECRET`, `RELAYER_PRIVATE_KEY`, `RPC_URL`.

## Files to touch (claude-relayer only)
- `apps/relayer/src/relayer.ts` (flow, auth), `apps/relayer/src/store.ts` (new: `Store` interface, memory + Postgres implementations), `apps/relayer/schema.sql`, `apps/relayer/api/relay.ts`, `apps/relayer/api/health.ts`, `apps/relayer/dev.ts`, `apps/relayer/package.json` (+ lock), `apps/relayer/test/*`
- `apps/relayer/.env` (append `DATABASE_URL` from the root `.env` and a new random `RELAY_API_SECRET`, nothing printed; the same secret goes into the root `.env` for the web app)
- `.batches/006-P2-neon-limits/*`, `notes/phase-2-relayer.md`

## Ponytail ladder
- **Needed?** Yes: R3 and FR-REL-5 block any public URL (human 00:45), and G2 needs the deployed relayer.
- **Two `Store` implementations** (memory for tests, Postgres for the service) — the interface exists because there are two real users of it, not for later.
- **New dependency (flagged):** `pg` 8.23.1 (+ dev `@types/pg`): TCP to Neon's pooler; `pg_advisory_xact_lock` works under pgbouncer transaction mode. No ORM, no migration tool (one idempotent SQL file).
- **Constants, not config** (human to set): `DAILY_BUDGET_WEI`, `PAYER_PER_HOUR`, `MERCHANT_PER_HOUR`.

## Out of scope
- MerchantPay `paySale` / `payInvoice` and their merchant guards, `order_paid` (batch 007 = research queue item 3); fee-vs-gas profitability beyond the 6 gwei cap; Vercel deploy (item 4, human approval); fee swap (item 5).

## NEEDS THE USER
- **Approved 03:09:** budget 0.1 WBT/day; payer 10/h, merchant 200/h; dependency `pg`; `DATABASE_URL` + a new `RELAY_API_SECRET` into `apps/relayer/.env`, `RELAY_API_SECRET` into the root `.env`.
