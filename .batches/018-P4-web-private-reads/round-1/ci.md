VERDICT: PASS

# CI, batch 018-P4-web-private-reads (phase mode, Money: yes; run by claude-frontend at 09:37)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 423, pass 421, fail 0, skipped 2 |
| Build | `npm run build` | exit 0 |
| CSP per route (curl on :3100) | connect-src | /merchant and /merchant/pages allow exactly the approved Nym hosts. /merchant/developers and /checkout are `'self'`. |

## Security pass: PASS (1 MEDIUM, 2 LOW, 3 INFO)
- **F1 MEDIUM, fixed:** /merchant/developers, which shows a new key or webhook secret once, keeps the strict policy and shows no meter.
- **F3 LOW, fixed:** only a revert (code 3, "revert") counts as Nym's answer. Any other Nym error falls back to the wallet's RPC for the rest of the page.
- **F2 LOW, open:** no test yet for the 10 s deadline or for sticking to the wallet after a failure (needs fake timers). The same goes for F3's new fallback.

## Builder evidence (scratch b018)
- 375 and 1440: one row each, no overflow.
- NFR-13: the Nym bundle never loads before first paint.
- A live production run under this CSP reached "Private reads 4 of 4" with no CSP violations.
- Known upstream gap: the harness hashes the bundle on the main thread (~1.1 s, after paint).
