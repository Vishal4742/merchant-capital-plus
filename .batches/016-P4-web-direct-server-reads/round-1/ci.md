VERDICT: PASS

# CI, batch 016-P4-web-direct-server-reads (phase mode, Money: yes; run by claude-frontend at 09:12)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 391, pass 389, fail 0, skipped 2 |
| Build | `npm run build` | exit 0 |
| Leftovers | `grep -rn "selfOrigin\|transportFor\|gatewayFor\|GATEWAY_PREVIEW" app lib components` | empty |
| Live :3100 | curl after the restart (RESTART/UP posted) | /, /l/x, /p/x, /merchant/links, /merchant/reports and /counter/l/x give 200 |
| Forged Host | `Host: 127.0.0.1:47998` on /l with a listener on that port | 0 bytes received: no server-side call follows the request's Host |

**Builder evidence (scratch b017):**
- hosted-pages runs on PGlite. A stored price wins, and there is no fetch at all under a forged Host.
- The per-payer limit: 20 open, the 21st is busy, another IP still opens.
- gateway-server checks each direct read against its route.
- 18/18 Playwright checks against a PGlite-backed Neon HTTP emulator.

**Not verified:** real Neon and Vercel Deployment Protection. Nothing calls our own origin any more, so the protection no longer matters to these pages.

## After the security pass (PASS; 2 LOW, 2 INFO)
- The 010 F1 SSRF and F2 shared bucket are both closed.
- **F2 LOW, fixed:** /merchant/payments logs the error's name only. Typecheck and lint pass; the live build picks it up at the next restart.
- **F1 LOW** (x-forwarded-for trusted off Vercel) is claude-contracts' known L6.
