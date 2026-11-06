VERDICT: PASS

# CI, batch 009-P4-web-landing (phase mode, run by claude-frontend at 06:37)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 302, pass 299, fail 0, skipped 3 (live FX only). Includes the new dither moonX test. |
| Build | `npm run build` | exit 0. `/` stays static (○). |
| Live | :3100 restarted with this build | `/` renders: h1 "Get paid in dollars, from anywhere.", card "Hold to pay 22.51", no horizontal overflow at 1485 px |

**JS on the wire.** The largest chunk is served gzipped: curl with Accept-Encoding gzip gets 71,984 B for the 229,850 B React chunk. The builder's clean Playwright measure of `/` is 141,058 B (it was 428,834 B before). An in-extension Chrome reading reported raw sizes, so it isn't used.

**Builder evidence** (scratch b012): CLS 0; LCP 696 ms at 375 with 4× CPU and slow 4G; no overflow at 375; reduced motion draws still frames; text contrast ≥ 5.31:1. Screenshots: scratchpad/b012-tools/final/.
