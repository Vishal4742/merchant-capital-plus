VERDICT: PASS

# CI, batch 014-P4-web-ux-fixes (phase mode, Money: no; run by claude-frontend at 08:22)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 391, pass 388, fail 0, skipped 3 |
| Build | `npm run build` | exit 0 |
| Live :3100 | curl after the restart (RESTART/UP posted) | /, /l/<unknown> and /merchant/pages give 200 |

**Screenshots (builder, scratch b016):** 56 shots in scratchpad/b016-shots/ at 375×812 (dpr 2) and 1440×900, light and dark.
- Pages: /l in every state (open, open amount, paid, expired, cancelled, not found, can't open), /p (items, amount, not found, can't open), /merchant/links, /merchant/pages and /merchant/payments. The payments screen shows 12 real payments from the chain.
- Every shot has `scrollWidth <= innerWidth`.

**Not on screen:** the new Pages empty state. The fixtures always hold pages; the copy is checked in source.
