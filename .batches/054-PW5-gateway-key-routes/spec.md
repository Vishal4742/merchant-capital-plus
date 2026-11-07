# Spec: 054-PW5-gateway-key-routes: secret-key gateway routes for the merchant connector, atomic link idempotency

## Requirements (cite docs/SRS.md IDs)
- FR-GW-16 (approved 2026-11-07, batch 052 srs-change.md): a merchant's sk_test_ key may create and read its links (POST
  with a durable Idempotency-Key), read one link with its paid checkouts, read its account profile and read its report.
  pk_ keys get 403; another merchant's ids get 404.
- FR-MCP-15 (approved): idempotent mutations. The same key and request give the same record; the same key with a
  different request is 422; a timeout or lost reply never duplicates.
- FR-GW-1, FR-GW-6, FR-GW-9, FR-PAY-4: existing link, key, report and checkout behaviour is kept. Sessions keep their
  idempotency unchanged.

## Acceptance criteria
- [ ] F1: a link and its replayable reply commit in **one** transaction, and the INSERT runs only if this request
  still owns the slot. Each of these leaves exactly one link: a failure after the INSERT (the old post-insert read), a
  commit whose reply was lost, a failure before the commit, and a slot abandoned for more than 5 minutes.
- [ ] A slot whose reply was stored is never deleted by the failing request's cleanup (`status IS NULL` guard).
- [ ] A reference conflict inside the transaction rolls everything back: 409, the slot is freed, no partial state.
- [ ] A secret-key caller must send an Idempotency-Key on POST /api/v1/links (400 otherwise). The dashboard session
  keeps it optional (compatibility).
- [ ] GET /api/v1/operations/{key}: the caller's own slot (links or sessions), `succeeded` or `pending`, plus its
  record id; another merchant's key is 404.
- [ ] Sessions: the same key replays and a different body is 422 (regression). Known residual (documented, owner
  claude-contracts/claude-sdk): a session reply that fails to store can be freed after 5 minutes. Recommended fix: the
  same atomic binding.
- [ ] `apps/web`: `npm run typecheck && npm run lint && npm test`.

## Files to touch
- apps/web/lib/server/idempotency.ts, links.ts, keys.ts, http.ts
- apps/web/app/api/v1/{links,links/[id],account,reports,sessions}/route.ts, app/api/v1/operations/[key]/route.ts (new)
- apps/web/test/gw-mcp-api.test.mjs, gw-links-atomic.test.mjs (new), docs-reference.test.mjs and test-mode.test.mjs
  (the Windows path fix)

## Ponytail ladder
Reuse `transaction(statements)` (lib/server/db.ts) and the existing slot table: no new table and no migration. The
link is built before the transaction, so its reply needs no read-back.

## Out of scope
Scoped or expiring keys, distributed rate limits, cursor pagination (Stage 2 and 4 on the Stage 3 stack, with
whiteflow-ef), atomic sessions, and docs-reference entries (claude-frontend).
