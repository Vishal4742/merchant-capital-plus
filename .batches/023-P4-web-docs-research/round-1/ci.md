VERDICT: PASS

# CI, batch 023-P4-web-docs-research (phase mode, Money: no; run by claude-frontend at 10:42)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 505, pass 503, fail 0, skipped 2. Includes docs-reference and the new docs-endpoints (the documented requests run against the real handlers on PGlite). |
| Build | `npm run build` | exit 0 |
| Live :3100 | curl /docs after the restart | 200; "How a payment works", payment.refunded and refunds/sync are present |

**At merge, the drift test caught a real change.** claude-contracts' refunds/sync (PR #22, lib/server/refunds.ts) now calls onRefund in production. So payment.refunded is documented as sent "when a refund is synced", the sync endpoint is in the API reference (Dashboard group), and the Quickstart's refund line is updated. This is the point of the test: the docs can't lag the code.

**Builder evidence (scratch b021):**
- 375 and 1440, light and dark: no overflow and 0 CSP violations.
- /docs JS is byte-identical (137,665 B).
- 8 docs-data mutants were killed.
- The documented curl ran against a live server: 201, and the read-back keys matched.
