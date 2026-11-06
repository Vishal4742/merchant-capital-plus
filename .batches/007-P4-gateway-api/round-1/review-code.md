VERDICT: PASS

# Review (code): 007-P4-gateway-api, round 1

Fast mode (PIPELINE §3a). I found no HIGH or CRITICAL issue. MEDIUM and LOW items are listed under FOLLOW-UP below.

## What I checked
- **Scope.** The worktree diff is `package.json` and the lock: two exact pins, `@neondatabase/serverless` 1.2.0 and `@electric-sql/pglite` 0.5.11 (dev), with no transitive additions. The untracked files are all in spec.md's Files list, and nothing else changed. Every module header cites its SRS IDs.
- **ABI and names.** The spec's functions are present and match: `query(text, params)`, `setTestDb`, `authenticateKey(req)`, `createQuote`/`getQuote`, `recordCheckout`/`checkoutOf`/`markCheckoutPaid`, `applyVoucher(merchant, code, sessionId, usdtAmount)`, `confirmRedemption`, `onSessionPaid(session)`, `onRefund(session, amount, totalRefunded)`. One deviation: the spec names `currentMerchant()`, but the code uses `signedInMerchant(request)`. It reads the same cookie with the same `readSession`, and it can be called without `next/headers`, so tests run the handlers directly. That is fine.
- **Two-driver rule.** Every BIGINT column comes back as `::text` (the `COLUMNS` constants, `count(*)::text`). There is no `timestamptz` and no `numeric`. INTEGER and BOOLEAN columns return JS number and boolean in both drivers. Neon's HTTP driver serializes `ANY($2)` array parameters through pg's `prepareValue` (I checked the bundled driver).
- **Type stripping.** No enums, namespaces or parameter properties. `HttpError` uses a plain field. Type-only imports use `type`.
- **Money and rounding.** FX conversion rounds up with exact fractions (20 EUR × 1.1224 = 22.448000). The AED peg is right: 10000/36725. A percent voucher's discount rounds down, which favours the merchant. A total under 1 USDT is refused. MerchantPay emits `toMerchant = net − toInvestors` with `net = gross − fee`, so the report's `net = toMerchant + toInvestors` equals gross − fee as the spec requires. Settlement `net` = toMerchant.
- **UTC days and range.** Days are bucketed with `toISOString().slice(0,10)`, and an empty day returns zeros. `to` defaults to today 00:00 UTC. Bad dates are refused (2026-02-30 round-trips to a different string). The range is capped at 92 days.
- **Webhook retries.** Attempts 1, 2 and 3 schedule the next try 1 m, 5 m and 30 m later. The 4th failure marks the delivery failed. The body is stored once and re-signed with a fresh `t` on every attempt. A lease keeps dispatch away from a delivery that is being attempted inline. `FOR UPDATE SKIP LOCKED` prevents overlapping runs.
- **Idempotency in events.ts.** Keys are `paid:<session>` and `refund:<session>:<total>`, and a failed enqueue releases its key. `markCheckoutPaid` and `confirmRedemption` are idempotent on their own.
- **Voucher race.** A data-modifying CTE claims the redemption, then `UPDATE … WHERE times_redeemed < max_redemptions`. The CHECK constraint backs this up, so removing the guard fails the test.
- **API shape.** Errors always use `{error}`, and a 500 logs only `err.name`. JSON is snake_case except two spots (FOLLOW-UP L1). Amounts go through `formatUnits`, so they are unpadded, except the webhook `data.amount` (FOLLOW-UP M2).
- **Commands I ran in `apps/web`:**
  - `node --experimental-test-module-mocks --test test/gw-*.test.mjs`: 95 tests, 95 pass, 0 fail.
  - `npx tsc --noEmit`: no output, no errors.
  - `npx eslint lib/server app/api/v1 db test/gw-*.mjs`: exit 0.
  - I did not run `npm run build`; the build note reports it passing.

## FOLLOW-UP (fix in the next batch)

**M1: `apps/web/db/010_links.sql:1`. Owner: lane (Builder A's file). Fix this before `db/migrate.mjs` runs on Neon.**
- *What:* line 1 is a comment that ends with `;` ("…(NULL: the payer enters the amount);"). `migrate.mjs` splits on `/;\s*$/m`, so it sends a comment-only statement to Neon.
- *Evidence:* I ran migrate's split through PGlite `query()`. PGlite accepts the statement. Whether Neon's HTTP endpoint accepts an empty query is unverified.
- *Why the tests miss it:* `gw-helpers.mjs` uses `pg.exec` on the whole file, so the split logic in migrate.mjs is never exercised.
- *Fix:* drop the `;` from that comment. Or, in migrate.mjs, filter out chunks that are only comments: `.filter((s) => s.replace(/--.*$/gm, "").trim())`.

**M2: `apps/web/lib/server/events.ts:16-28, 48-50`. Owner: lane + claude-sdk.**
- *What:* the webhook `data` doesn't match claude-sdk's `GatewayEvent.data: Session` (packages/sdk/index.ts:34-60):
  - `currency` is missing, though the SDK type requires it.
  - `refunded` holds this refund's amount, but in the SDK `Session.refunded` and `Payment.refunded` mean the running total. A shop that reads `data.refunded` after a second partial refund gets the wrong number.
  - `amount` is padded (`"25.00"`), while the spec says amounts are unpadded and the rest of the API sends `"25"`.
  - camelCase (`paymentId`, `txHash`) is mixed with snake_case (`link_id`, `total_refunded`).
  - A `payment.refunded` event carries `status: "paid"`.
- *Fix:* agree one shape with claude-sdk:
  - add `currency: "USDT"`;
  - make `refunded` the running total, and either name this refund `refund_amount` or drop `total_refunded`;
  - use `formatUnits(units, 6)` instead of `plain`, if claude-sdk agrees.

**M3: `apps/web/lib/server/vouchers.ts:207-218`, together with `events.ts:44`. Owner: lane (Builder B's file).**
- *What:* `confirmRedemption` counts the reserved voucher whenever the session is paid. It never checks that the amount paid equals the reserved discounted total (`app_gw_redemptions.usdt_amount`).
- *Why:* there is no way to remove a reserved code. If the payer removes the code on the checkout, or signed the full price before applying it, the merchant loses one use and `times_redeemed` is too high.
- *Fix:* `confirmRedemption(sessionId, paidAmount)`, with `AND usdt_amount = $3` in the claiming CTE. `onSessionPaid` passes `session.amount`.

**M4: webhook retries need a scheduler (FR-GW-7). Owner: lane.**
- *What:* nothing calls `POST/GET /api/v1/webhooks/dispatch` yet. There is no `vercel.json` cron, and on Vercel's Hobby plan cron runs at most once a day (check the team's plan). In a deployment, the 1 m / 5 m / 30 m retries therefore never run.
- *Fix:* run a local loop or an external cron against dispatch during the demo (ARCHITECTURE §6 "keepers … or a local loop"), and record that in the next batch.

**L1: casing and stale names in the docs. Owner: lane + claude-research (docs).**
- *What:*
  - `kpis: {newPayers, returningPayers}` (reports.ts:174) is camelCase in an otherwise snake_case API. The spec text spells it camelCase, but the 03:31 agentbus decision says snake_case.
  - The spec text still says `createdAt` (keys) and `nextAttemptAt`/`responseStatus` (webhooks), and ARCHITECTURE §4b says `expire_by`. The code sends `created_at`, `next_attempt_at` and `expires_at`.
- *Fix:* settle the KPI casing with claude-frontend, and ask claude-research to bring the spec and §4b in line with the code.

**L2: duplicated small helpers (Ponytail). Owner: lane.**
- *What:* `formatUnits(x, 6)` is wrapped four times: `decimal` (links.ts:33), `usdt` (vouchers.ts:61 and reports.ts:54), and `plain` (events.ts:13). ISO-date helpers exist twice, `iso` in links.ts:34 and webhooks.ts:58, plus inline copies in keys, quotes and vouchers. `EventType` is declared in both events.ts:12 and webhooks.ts:19.
- *Fix:* one `decimal` and one `iso` in http.ts; events.ts imports `type EventType` from webhooks.ts.

**L3: `apps/web/lib/server/pages.ts:76`. Owner: lane.**
- *What:* `if (!name) throw …` can never run, because `textField(..., required)` already throws on an empty name.
- *Fix:* delete the line.

**L4: `apps/web/lib/server/keys.ts:65`. Owner: lane.**
- *What:* after `WHERE key_hash = $1`, `timingSafeEqual` compares the hash with itself; the database lookup already did the compare.
- *Fix:* none needed. It is harmless and the spec asks for it, so it can stay or go.

**L5: unbounded growth. Owner: lane.**
- *What:*
  - The rate-limit `Map` in `http.ts:124` never evicts expired keys, so it grows by one entry per new IP on each instance.
  - Each `POST /api/v1/quotes` call is public and writes an `app_gw_quotes` row, and nothing ever deletes old rows.
- *Fix:*
  - delete an entry once `resetAt <= now` (or cap the map's size);
  - add `DELETE FROM app_gw_quotes WHERE expires_at < $1` to the dispatch run.

**L6: `apps/web/lib/server/vouchers.ts:153`. Owner: lane.**
- *What:* `listVouchers` has no `LIMIT`, while links and pages cap their lists at `MAX_LIST` (200).
- *Fix:* add `LIMIT ${MAX_LIST}`.

**L7: `apps/web/lib/server/vouchers.ts:84`. Owner: lane.**
- *What:* a 100 % voucher can be created, but `applyVoucher` always refuses it (the total would be 0, under 1 USDT).
- *Fix:* cap the percent at 99, or say this in the 400 message at create time.

**L8: `apps/web/lib/server/reports.ts:100`. Owner: lane.**
- *What:* `BigInt(log.blockNumber ?? 0)` runs outside the try, so a malformed `blockNumber` from the index gives a 500 instead of the 502 the route uses for index failures.
- *Fix:* parse it inside `decoded`, or guard it with `/^(0x[0-9a-f]+|\d+)$/i`.

**L9: `apps/web/lib/server/reports.ts:2`. Owner: lane.**
- *What:* this copies onchain.ts's Blockscout fetch (a `ponytail:` comment says so). claude-frontend said on agentbus (03:43) that it will export a generic `indexedLogs` from `lib/onchain.ts`.
- *Fix:* switch to the shared fetcher once it is exported.

**L10: `apps/web/lib/server/webhooks.ts:158`. Owner: lane.**
- *What:* if `attemptDelivery` throws (a database error on its UPDATE) after the delivery rows were inserted, `enqueueEvent` rejects and `sendOnce` releases the event key. The caller's retry then inserts a second set of deliveries with a new `evt_` id, which the merchant can't deduplicate.
- *Fix:* `attemptDelivery(id, now).catch(() => null)` inside `deliver`. The rows stay pending behind the lease, and dispatch retries them.

**L11: cross-lane context, not a finding against this batch. Owner: claude-frontend.**
- *What:* `lib/sessions.ts` keeps sessions in memory on each serverless instance. On Vercel, the instance serving `/checkout/{id}` may not have a session that a public link or page checkout created on another instance. AT-11 in production depends on sessions moving to Neon.

**L12: `.batches/007-P4-gateway-api/batch.md`. Owner: lane.**
- *What:* the Owner lane line is still the placeholder `<claude-contracts|…>`, and Request is empty.
- *Fix:* fill both in.

## Tests
The tests check the acceptance criteria, and most of them would fail on a regression:
- fixed vectors for the 20 EUR quote and the signature;
- an independent HMAC check, plus the SDK's own `constructEvent`;
- about 30 SSRF URLs, including private DNS answers and a v4-mapped address;
- the full retry schedule with exact `next_attempt_at` values;
- UTC midnight on both sides;
- paging past 1,000 logs, with no double counting;
- other merchants' logs, ids and vouchers stay invisible.

Gaps:
- Nothing exercises `migrate.mjs` (see M1).
- PGlite runs one connection, so the voucher race test runs in sequence. Postgres's row re-check under READ COMMITTED makes the real race safe; the test still fails if the guard is removed.
