VERDICT: PASS
# 047-P5-debtor-ack round 1: ci

Run in apps/web on branch p5-debtor-ack at f2d6295 (before merging origin/main, which brought only AGENTS.md, README.md
and CODEOWNERS), 2026-11-06 IST, after `npm ci --ignore-scripts`. No env file (as CI runs it).

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 (`✓ Types generated successfully`, tsc no errors) |
| Lint | `npm run lint` | exit 0, no findings |
| Tests | `npm test` | exit 0: tests 719, pass 717, fail 0, skipped 2 |
| Build | `npm run build` | exit 0, `✓ Compiled successfully`; new route `ƒ /api/v1/invoices/[id]/acknowledge` |
| Pre-push | `git push` (tools/githooks/pre-push) | web typecheck, lint, tests: all checks passed |

The build log has two `shop key check: Error` lines: lib/shop-auth.ts logging the missing database while Next
prerenders the payments and sessions routes with no DATABASE_URL. Not from this batch (no file it touches imports
shop-auth).

New tests: test/invoice-ack.test.mjs (16, red at 5d84af6, green after): the typed data (domain, CapitalMarket pinned to
packages/shared, field order); a valid ack stored and answered; wrong signer, tampered amount / merchant / due date /
invoice id, wrong chain, wrong contract → 400 with nothing stored; a browser-sent amount is never read; malformed
bodies 400; idempotent (same debtor no-op with the first time, another debtor 409, one row); our shop's open invoices
only, never by the shop itself, 503 on a failed chain read; part-paid still acknowledgeable; rate limit (11th in a
minute 429, another IP fine); acksFor scoped to MerchantPay; the guest key's and a wallet provider's acks pass the
route (one `eth_signTypedData_v4`, no transaction method); offers carry `debtor_acknowledged` + the short debtor (never
the signature or the full address), false/null otherwise, and an unreadable ack store keeps the book on screen;
FR-ARK-4 (no debtor key in the Arkiv terms); UI states pinned in the source. test/capital-core.test.mjs: the offerJson
shape gains `debtor_acknowledged: false, debtor_ack: null`.

Not run: the pages in a browser. A local `next start` can't render /pay or the offer book without the Neon database
and chain reads (the env file is off limits to agents); the check moves to the PR's Vercel preview.

Security review fixes (H1, M1, L1), red at 55fd9f6 → f150be1, a273e0f, c4d6682: `npm run typecheck` exit 0 ·
`npm run lint` exit 0 · `npm test` tests 724, pass 722, fail 0, skipped 2 · `npm run build` exit 0 (`✓ Compiled
successfully`; the same two pre-existing `shop key check: Error` prerender lines).

Re-review items (copy, 5-ack cap + acksFor LIMIT + "5+", checksummed customer), red at 3803a41 → df77be7:
`npm run typecheck` exit 0 · `npm run lint` exit 0 · `npm test` tests 727, pass 725, fail 0, skipped 2 ·
`npm run build` exit 0 (`✓ Compiled successfully`; the same two `shop key check: Error` lines).
