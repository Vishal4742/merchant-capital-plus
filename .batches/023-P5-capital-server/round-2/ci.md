VERDICT: PASS

Batch 023-P5-capital-server, round 2, branch capital-server. Run in apps/web.

| Command | Exit | Output tail |
|---|---|---|
| `npm run typecheck` | 0 | `next typegen && tsc --noEmit` -> "Types generated successfully", no tsc errors |
| `npm run lint` | 0 | `eslint`, no output |
| `npm test` | 0 | tests 532, pass 530, fail 0, cancelled 0, skipped 2, todo 0 (about 29.5 s) |
| `npm run build` | 0 | all six capital routes listed (below) |
| secret scan (pre-push pattern, `git grep -nE ... -- ':!tools/agentbus.py'`) | no match | empty output |
| `git diff --cached --name-only` | - | empty (nothing staged) |

Build output, capital routes:
```
├ ƒ /api/v1/capital/fund
├ ƒ /api/v1/capital/merchant
├ ƒ /api/v1/capital/offers
├ ƒ /api/v1/capital/offers/[id]/publish
├ ƒ /api/v1/capital/quote
├ ƒ /api/v1/capital/transfer-check
```

`git diff --stat origin/main...HEAD` (17 files, 1192 insertions):
```
.batches/023-P5-capital-server/{batch.md, spec.md, round-1/review-security.md, round-2/review-security.md}
apps/web/app/api/v1/capital/{fund,merchant,quote,transfer-check,offers}/route.ts, offers/[id]/publish/route.ts
apps/web/lib/server/{capital,capital-arkiv,capital-fund}.ts
apps/web/test/capital-{core,arkiv,fund,routes}.test.mjs
```
Only the expected paths; no stray merge files. The diff touches neither contracts nor the relayer, so I skipped forge and the relayer suites.
