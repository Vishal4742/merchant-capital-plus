VERDICT: PASS

# CI, batch 010-P4-web-links-pages-qr (phase mode, run by claude-frontend at 06:42)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 331, pass 328, fail 0, skipped 3 (live FX only); re-run after the F1 fix. New: gateway-client, gateway-forms, hosted-pages, qr (each QR decoded back to its exact URL). |
| Build | `npm run build` | exit 0. New routes: /l/[slug], /p/[slug] (+ /checkout), /qr/[kind]/[id], /counter/[kind]/[id], /merchant/{links,pages,payments} |
| Dependency | `npm install --save-exact uqr@0.1.3` | human-approved 06:30; MIT, zero dependencies; server-only |
| Live :3100 | curl after the restart with DATABASE_URL | /, /merchant, /merchant/{links,pages,payments}, /l/x, /p/x, /qr/pay/1 and /counter/pay/1 answer 200. `img-src https:` only on /p and /merchant/pages; elsewhere `img-src 'self' data:`. Public link lookup gives 404 "No such payment link."; dashboard links without sign-in give 401. |

**Builder evidence** (scratch b011, 92 screenshots in scratchpad/b011-shots/):
- No overflow at 375 or 1440; 0 CSP violations.
- 0 crypto words on /l, /p or /counter; no browser chain reads.
- Chrome's own reader decodes the counter QRs.
- NFR-12: /l and /p ship 145,665 B of JS.

**Not yet verified live:** a merchant creating a link, then a customer paying it (AT-11). That needs a signed-in wallet in the human's browser.

## After the security pass (PASS; 2 MEDIUM, 3 LOW)
- **F1 MEDIUM, fixed: SSRF through a forged Host.**
  - `selfOrigin()` (lib/gateway-server.ts) calls our own gateway routes at `http://127.0.0.1:$PORT` (next start sets PORT), or at `https://$VERCEL_URL` on Vercel. It never uses the request's Host.
  - The hosted-pages tests now forge `Host: evil.example:47123` and assert that the call still goes to 127.0.0.1:3111.
  - Live probe on :3100: a forged `Host: 127.0.0.1:47999` sends 0 bytes to a listener there.
- **LOW, fixed:** QR codes and copied URLs go through `publicOrigin()`, so PUBLIC_ORIGIN wins.
- **Open for the P4 fix batch:**
  - F2 MEDIUM: call lib/server/* directly instead of over HTTP, so the per-IP rate limit sees each payer.
  - LOWs: debounce the logo preview; cap `readForm` before reading.
