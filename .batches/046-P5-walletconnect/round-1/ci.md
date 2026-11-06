# 046-P5-walletconnect round 1: ci

Run in apps/web on branch p5-walletconnect (after `npm ci`, which needs the new apps/web/.npmrc), 2026-11-06 ~20:15 IST.
Plain build with no env file and no NEXT_PUBLIC_PRIVY_APP_ID (as CI runs it); a second build with the public app ID
also passed.

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 (`✓ Types generated successfully`, tsc no errors) |
| Lint | `npm run lint` | exit 0, no findings |
| Tests | `npm test` | exit 0: tests 698, pass 696, fail 0, skipped 2 |
| Build | `npm run build` | exit 0, 0 error lines (`✓ Compiled successfully`) |
| Install | `npm ci --ignore-scripts` | exit 0 (refused with ERESOLVE before .npmrc `legacy-peer-deps=true`) |
| Audit | `npm audit --omit=dev` | before this batch: 0 vulnerabilities. After: 31 (0 critical, 20 high, 11 moderate), all transitive from Privy's tree: decode-uri-component (GHSA-vcc3-ghjq-m6fr, GHSA-qr28-fpjm-wq7f), uuid (GHSA-w5hq-g745-h8pq), ws (GHSA-58qx-3vcg-4xpx, GHSA-96hv-2xvq-fx4p), zod (GHSA-mrhx-c7xc-m3w5); DoS / memory classes, in code that runs only in the customer's browser after the Privy press |
| First load | `.next` client reference manifest for /checkout/[sessionId] | Privy's chunks (the two holding `auth.privy.io`, 389 KB and 69 KB raw) are not referenced; the page's 5 client chunks are 42.5 KB gzip |

New tests (red at 944cfcc, green after): test/privy-pay.test.mjs (6), test/payer-wallet.test.mjs (+2: one
`eth_signTypedData_v4`, no transaction method, the pay route relays it; provider failure and cancel are plain
sentences), test/csp-routes.test.mjs (+2: pay-sheet routes list exactly Privy's hosts; /r, /counter, /docs,
/merchant/developers stay 'self').

Not run: the Privy modal in a browser. A local `next start` can't render a checkout without the database, and Privy
only answers origins allowed in its dashboard; the check moves to the PR's Vercel preview once the human allows its
origin.

VERDICT: PASS (typecheck, lint, tests, build). Open items for the human gate: the audit findings above, the browser
check of the modal on the preview.
