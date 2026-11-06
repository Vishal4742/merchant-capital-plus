VERDICT: PASS

Re-run after the security F2 fix (2864ac7), apps/web: `npm run typecheck` exit 0, `npm run lint` exit 0, `npm test` exit 0
(tests 595, pass 593, fail 0, cancelled 0, skipped 2), `npm run build` exit 0 ("✓ Compiled successfully in 913ms").
Voucher suites (voucher-arkiv-read, gw-vouchers, gw-tester-vouchers, voucher-pay, gw-single-use, gw-vouchers-paid-race):
97/97 pass. The F2 test failed before the SQL change and passes after it.

First run (3dc6499) for the record:
Run in the batch worktree (branch p5-voucher-arkiv-read, HEAD 3dc6499, up to date with origin/main), apps/web, node v26.10.0.

- `npm run typecheck` exit 0 ("✓ Types generated successfully", `tsc --noEmit` clean)
- `npm run lint` exit 0 (eslint, no output)
- `npm test` exit 0: tests 594, pass 592, fail 0, cancelled 0, skipped 2, todo 0 (duration 35.4 s)
- `npm run build` exit 0 ("✓ Compiled successfully in 2.4s", all routes listed). The "gateway api error: Error" /
  "shop key check: Error" lines while prerendering are the same as batch 008's ci.md (no database at build time).

New and touched tests (`node --experimental-test-module-mocks --test test/voucher-arkiv-read.test.mjs test/gw-vouchers.test.mjs`):
tests 56, pass 56, fail 0. Before the build the 6 new FR-ARK-7 cases failed and the 2 "unchanged behaviour" cases passed
(red commit 628f69b).

Secret scan (tools/githooks/pre-push pattern, `git grep -nE … -- ':!tools/agentbus.py' ':!*.env*'`): 0 matches.
`git diff --cached --name-only`: empty.

Screenshot: the landing advance card at 1440 px (headless Chrome against `next start`) reads
"640.00 OF 1,000.00 FUNDED · 2 INVESTORS".

`git diff --stat origin/main...HEAD` (before this file):
 .batches/034-P5-voucher-arkiv-read/batch.md |   8 ++
 .batches/034-P5-voucher-arkiv-read/spec.md  |  56 ++++++++++
 apps/web/components/landing/Sections.tsx    |   2 +-
 apps/web/lib/server/vouchers.ts             |  43 ++++++-
 apps/web/test/gw-vouchers.test.mjs          |   6 +-
 apps/web/test/voucher-arkiv-read.test.mjs   | 167 ++++++++++++++++++++++++++++
 6 files changed, 276 insertions(+), 6 deletions(-)
