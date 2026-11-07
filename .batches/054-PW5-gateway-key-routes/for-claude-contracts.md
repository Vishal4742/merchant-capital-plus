# Handoff to claude-contracts: gateway routes for the merchant connector (batch 054)

From lane claude (batch 052), 2026-11-07. The human decided "Approve SRS, hand routes over": the SRS-CHANGE FR-GW-16
and FR-MCP-15 is approved, and these gateway routes are yours to review, own and land. Branch `wf/gateway-secret-key-routes`
(from main), draft PR "[handoff → claude-contracts]". PR #45 (packages/mcp) no longer contains them.

## What it changes (apps/web only, no migration)
| Route / module | Behaviour |
|---|---|
| `lib/server/keys.ts` `callerMerchant()` | session or sk_test_ key; pk_ 403; none, unknown or revoked 401; returns `{merchant, via, keyId}` |
| `POST /api/v1/links` | sk key allowed; **a secret-key write must send an Idempotency-Key** (400); the dashboard may omit it. With a key, the link and its replayable 201 reply commit in **one transaction** (`createLinkOnce`), and the INSERT is guarded on still owning the slot. 30 creates a minute per merchant |
| `GET /api/v1/links`, `GET /api/v1/links/{id}` (new) | sk key allowed; `{id}` returns `paid_checkouts` from `app_web_sessions.payment`, merchant-scoped, 404 for foreign ids |
| `GET /api/v1/account` (new) | the key's merchant, chain, settlement token, price currencies, payment limits, `timezone: null`, `scopes: null`, `capabilities` (incl. `operations: true`) |
| `GET /api/v1/reports` | sk key allowed (pk 403) |
| `GET /api/v1/operations/{key}` (new) | the caller's own slot for links or sessions: `succeeded` or `pending`, plus `result_id`; foreign, unknown or older than 24 h is 404 |
| `lib/server/idempotency.ts` | the sessions route's slot code, extracted. `run` receives `{slot, owner}`; a reply already committed by the route (`stored`) isn't stored twice; a slot is freed **only while `status IS NULL`** |

## Production review F1: reproduced and fixed
`test/gw-links-atomic.test.mjs` injects faults into PGlite. Before the fix:
- a failure after the INSERT gave 2 links;
- a lost reply after commit gave 2 links;
- a failed reply storage followed by abandonment gave 2 links.

After the fix, every boundary leaves exactly 1 link. A reference clash rolls back with a 409 and frees the key.

## Residuals you own (not fixed here)
- **Sessions** (`POST /api/v1/sessions`) still store their reply after `createSession`. If that UPDATE fails, the
  slot frees after 5 minutes and a retry can open a second, unpaid checkout (it expires in 30 minutes). Fix: the same
  atomic binding as links (write the session row and the slot reply in one `transaction`). This also touches
  claude-sdk's shop behaviour.
- Rate limits are per process (`lib/server/http.ts` `rateLimit`, a Map). Move them to Postgres or Redis for a
  merchant-wide quota (review F7).
- `listLinks` is capped at 200 and `paid_checkouts` at 50 with no cursor or completeness flag (review F7).
- `docs-reference.ts` doesn't list `/api/v1/account`, `/api/v1/links/{id}`, `/api/v1/operations/{key}`, the
  Idempotency-Key on links or the 30-a-minute limit (claude-frontend's file).
- Batch 051 (whiteflow-ef) replaces `callerMerchant` with `legacyAccess(request, scope, {secretKey})`. The mapping is
  agreed: links POST → `invoices:draft`, links GET and `{id}` → `invoices:read`, reports → `payments:read`. Also
  `invoices:draft` is added to `SECRET_KEY_SCOPES` (R2-1, approved with the SRS change), and link slots get keyed by
  business.

## Verify
`cd apps/web && npm run typecheck && npm run lint && node --experimental-test-module-mocks --test test/gw-links-atomic.test.mjs test/gw-mcp-api.test.mjs`
and then the full `npm test` (the pre-push hook runs it).
