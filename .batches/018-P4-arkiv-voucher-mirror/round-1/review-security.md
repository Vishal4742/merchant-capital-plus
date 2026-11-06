VERDICT: PASS

# Security review: 018-P4-arkiv-voucher-mirror, round 1 (phase mode, Money: yes, one pass)

Reviewer: security. Scope: commit 21e8d0f, the apps/web part (`lib/server/vouchers.ts`, `db/049_arkiv_status.sql`, `app/api/v1/vouchers/[id]/publish/route.ts`, `test/gw-vouchers.test.mjs`), plus the code it calls: `lib/arkiv.ts`, `lib/server/http.ts`, `lib/auth.ts` setCookie, and `@arkiv-network/sdk` 1.0.1 / viem 2.57.13 in node_modules. HEAD (cec97a5) leaves these files unchanged. I read no `.env*` file and used no key.

No HIGH or CRITICAL findings. One MEDIUM and three LOW, none blocking.

## What holds

- **No secret reaches the stored reason, the API or the logs.**
  - The write-error path (`vouchers.ts:156`) runs the error through `redactArkivError`, which replaces both the raw and the `encodeURIComponent` form of the access key. The SDK uses the encoded form in the RPC path (`rabdi.ts:46`), and viem's `getUrl` returns that URL unchanged. Redaction happens before `.slice(0, 200)`, so a cut can't leave part of the key behind.
  - The private key never appears in an SDK or viem error, because signing is local. `arkivClients` catches the noble error and throws a fixed string (`arkiv.ts:19`).
  - `VOUCHER_HASH_SECRET` is only the HMAC key. Its missing-case message names the variable, not the value (`vouchers.ts:144`).
  - `recordMirror` logs only the same capped reason (`vouchers.ts:163`), and `handle` logs `err.name` only.
- **The arkivClients catch (`vouchers.ts:147-149`) is safe today.** Every throw site was checked in the installed source: the two fixed strings (`arkiv.ts:13,19`), `MissingAccessKeyError` (fixed text, and unreachable after the trim check), and viem's `UrlRequiredError`. `createClient` doesn't throw. None of them includes a value. See L2 for hardening.
- **Owner only.** `WHERE id = $1 AND merchant = $2` with a lowercased address. Another merchant's id and an unknown id both return the same 404, so there is no existence oracle. A request without the cookie gets 401 (tested). The session cookie is `SameSite=Lax; HttpOnly` (`auth.ts:116`), so a cross-site POST carries no session and CSRF can't trigger a publish.
- **Idempotent when calls are sequential.** A voucher that already has an entity key is returned without a write (`vouchers.ts:177`, tested with `arkiv.calls.length === 1`). Concurrent calls are not covered; see M1.
- **Expired vouchers are refused** with 409 before any write (`vouchers.ts:178`, tested).
- **Rate limit.** Publish uses the same key (`vouchers:${merchant.toLowerCase()}`), limit (30) and window (1 h) as create (`route.ts:11` in both routes). It runs after auth and before the DB read and the write.
- **FR-ARK-4.** The Arkiv values are unchanged: `type, merchant, code_hash (HMAC-SHA256), kind, value, expires_at`. The plain code and personal data never go on Arkiv. The plain code isn't in the transaction payload either, so it can't show up in an RPC error. `arkiv_error` and `arkiv_tx_hash` appear only in `voucherJson`, which only owner-authenticated paths return (GET/POST `/api/v1/vouchers`, publish, `gateway-server.ts:41` merchantVouchers). No public payer endpoint returns them.
- **Migration 049** only adds columns (`ADD COLUMN IF NOT EXISTS`), so it is idempotent. It adds no PII column.
- **Tests:** `env -i PATH HOME node --experimental-test-module-mocks --test test/gw-vouchers.test.mjs` → `tests 39, pass 39, fail 0`.

## Secret-pattern grep (mandated)

`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the six batch files. Every hit is a variable name or a test fixture. No values.
- `batch.md:8`: names `VOUCHER_HASH_SECRET`, `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY` as present or absent (booleans), no values.
- `test/gw-vouchers.test.mjs:10,56,78,140,141,587,588,596`: the fixture `HASH_SECRET = "voucher-hash-secret-for-tests"` and the env variable name.
- `lib/server/vouchers.ts:143,144`: `process.env.VOUCHER_HASH_SECRET` read and the fixed missing-case message.
- No 64-hex literals. The test hashes are built at runtime from `"cd".repeat(32)`.

## Findings

### M1 (MEDIUM): publish is idempotent only when calls are sequential, so a duplicate Arkiv entity can be written
- **Where:** `lib/server/vouchers.ts:173-179` (check, then write, with no claim), `:191` (createVoucher's mirror runs with nothing marking it in flight), `:155-156` (the catch drops `EntityMutationError.txHash`).
- **Exploit sketch:**
  1. The merchant, a second tab, or the coming "Publish to Arkiv" button sends `POST /publish` while the create's mirror is still running. The SDK waits for the receipt (viem's default timeout is 180 s; each HTTP request has 30 s). During that window the row has `arkiv_entity_key = NULL` and `arkiv_error = NULL`, so publish writes a second entity. N parallel publishes on an unmirrored voucher send N `createEntity` txs. The DB keeps the last key, and the other entities stay on Arkiv as orphans with the same `code_hash` until expiry.
  2. If the tx was broadcast and only the receipt wait failed (timeout or polling error), the SDK throws `EntityMutationError` with `txHash` set. `mirrorToArkiv` throws that away and stores "Arkiv refused or timed out", although the entity exists. The next publish writes it again. AT-12 says "nothing said why", which may be exactly this case.
- **Impact:** extra spend on the shared writer key and duplicate public entities. Bounded by the 30/h limit per merchant per instance. No secret is exposed and no USDT is at risk. The data on Arkiv is the same safe data, so this doesn't block.
- **Fix:**
  - Claim before writing. Use one conditional UPDATE: `UPDATE app_gw_vouchers SET arkiv_attempted_at = $now WHERE id = $1 AND merchant = $2 AND arkiv_entity_key IS NULL AND (arkiv_attempted_at IS NULL OR arkiv_attempted_at < $now - 240000) RETURNING …`. Return 409 "A publish is already in progress" when no row comes back. Set `arkiv_attempted_at` in createVoucher's INSERT as well.
  - On failure, store `err.txHash` when it is a hex string. In publish, when `arkiv_tx_hash` is set and `arkiv_entity_key` is null, read the receipt first (or query the reader for `code_hash`), and write only if nothing landed.
  - Test: two concurrent `publishAs(id)` calls lead to `arkiv.calls.length === 1`.
- **Owner:** claude-contracts.

### L1 (LOW): publish doesn't refuse a deactivated voucher
- **Where:** `lib/server/vouchers.ts:177-178`.
- **Sketch:** After `POST /deactivate`, `active = false`, but publish still mirrors the voucher. The entity has no `active` field, so the public mirror lists a dead code, and each call spends a writer-key write. Redemption is checked in the DB, so no money is at risk.
- **Fix:** `if (!voucher.active) throw new HttpError(409, "This voucher is deactivated, so it isn't published.")`, with a test.
- **Owner:** claude-contracts.

### L2 (LOW, defense in depth): the arkivClients catch stores the raw message, with no redaction and no cap
- **Where:** `lib/server/vouchers.ts:149`.
- **Sketch:** Safe today (see "What holds"). But if a future SDK or viem version echoes the RPC URL while building the client (the URL contains the access key), it would be stored and shown with no redaction.
- **Fix:** send it through the same path, `redactArkivError(err, process.env.ARKIV_ACCESS_KEY).slice(0, MAX_REASON)`.
- **Owner:** claude-contracts.

### L3 (LOW, test gap): spec cases not covered
- **Where:** `test/gw-vouchers.test.mjs:14-29, 571-633`.
- **Gaps:**
  - The spec's "missing Arkiv config" case has no test, because the mock `arkivClients` never throws.
  - The 200-char cap has no test.
  - The file mocks `redactArkivError` with a replace of the raw key only. The real function's encoded-form redaction is covered in `test/arkiv.test.mjs:41-46`.
- **Fix:** add a test where `arkivClients` throws `"ARKIV_ACCESS_KEY is missing."` and expect `arkiv_error` to equal it. Add another where a 1,000-char error contains the key and expect `length <= 200` with no key.
- **Owner:** claude-contracts (tester).

## Notes (no action in this batch)
- **I1:** `arkiv_error` tells the signed-in merchant which env variable is missing (`VOUCHER_HASH_SECRET isn't set on this server.`). It shows names, never values, and the spec allows it.
- **I2 (claude-frontend):** part of `arkiv_error`'s text comes from the Arkiv RPC (node messages, revert reasons). Render it as plain text (the React default), never as HTML, and keep it out of any analytics or third-party call.
- **I3 (pre-existing, batch 007):** sign-in is open to any wallet, and `rateLimit` lives in memory per serverless instance. So the cap on writer-key spend applies per address and per instance, not globally. Publish doesn't widen this: on a mirrored voucher it is a no-op, and on a failing one it shares the same 30/h. The real cap would be a global daily write budget for Arkiv. Out of scope here.
- **I4 (AT-12 backfill, not in this commit):** run it through `publishVoucher` or the route, and post only the entity key, tx hash and `expires_at`, with no env output. G4AT12 dates from before this batch, so it has no stored outcome. Because of M1(2), first check that no entity with its `code_hash` already exists from the writer (reader query on the indexed `code_hash`, or the writer address on the Rabdi explorer) before writing, so the backfill doesn't create a duplicate.
