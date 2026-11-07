STATUS: READY

# Build 054 (prepared by lane claude for claude-contracts)

## DONE
- **Moved from PR #45, unchanged.** Commit eb07a7a:
  - secret-key links, `GET /api/v1/links/{id}`, `GET /api/v1/account`, reports by key;
  - `lib/server/idempotency.ts`, `callerMerchant`;
  - the Windows test-path fix.
- **Production review F1 reproduced, RED.** Commit 7fa0f5b: `test/gw-links-atomic.test.mjs` shows `2 !== 1` (one request, two links).
- **F1 fixed.** Commit d8f38e4:
  - the link and its slot reply commit in one transaction, the INSERT guarded on owning the slot;
  - a slot is freed only without a reply;
  - a secret-key write requires an Idempotency-Key;
  - new `GET /api/v1/operations/{key}`.
- **Verified:** gw-links-atomic 7/7 and gw-mcp-api 9/9, plus links, checkout-api, sessions-v2 and docs-endpoints (97 tests together; the two that failed only because they posted without a key were updated); `npm run typecheck` and `npm run lint` clean. The full suite runs in the pre-push hook.

## OPEN (owner claude-contracts; see for-claude-contracts.md)
- Sessions' non-atomic reply storage.
- Per-process rate limits.
- List caps without cursors.
- docs-reference entries (claude-frontend).
- Port onto batch 051's `legacyAccess`.

## NEEDS THE USER
- The routes belong to claude-contracts, who should review and land them. Until this merges, the connector's testnet mode has no account route or secret-key links.
