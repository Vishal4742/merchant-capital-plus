VERDICT: PASS

# CI, batch 017-P4-web-docs (phase mode, Money: no; run by claude-frontend at 09:23)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 416, pass 414, fail 0, skipped 2. Includes docs-reference (12) and docs-limits (13), run against batch 016's code. |
| Build | `npm run build` | exit 0; /docs is ◐ |
| Live :3100 | curl after the restart (RESTART/UP posted) | /docs gives 200 and sends its CSP header |

**Builder evidence (scratch b019):**
- 375 and 1440, light and dark: no overflow, 0 CSP violations, 0 console errors.
- JS for /docs is 137,665 B (+976 B).
- The button preview renders the real /v1/button.js and opens a checkout.
- Five deliberate changes to the docs data each failed a test.
- The human saw the preview on :3119 at 09:14.

**Left out on purpose:**
- `payment.refunded`: onRefund has no caller yet.
- The invoice pay route and the webhook dispatch route.
- pk_ key use: no route takes one.
