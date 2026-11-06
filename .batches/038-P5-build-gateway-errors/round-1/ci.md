VERDICT: PASS

Batch 038 round 1, commit c7b3878 (apps/web only).

## tsc

## lint

> web@0.1.0 lint
> eslint


## test
✔ no sheet amount (an older sheet) keeps today's path: verified at the claimed price (109.959042ms)
✔ a malformed sheet amount is a 400 before anything is locked or claimed (121.637417ms)
✔ the sheet amount is checked after the lock and the open check: there, a 409 or STILL_PENDING releases nothing (149.387167ms)
✔ the checkout read runs while the body is still arriving (NFR-4) (30.632166ms)
ℹ tests 590
ℹ suites 0
ℹ pass 588
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 42755.018792

## build
├   /pay/[invoiceId]
│ └ ◐ /pay/[invoiceId]
├ ○ /proofs
├ ƒ /qr/[kind]/[id]
└   /r/[id]
  └ ◐ /r/[id]


○  (Static)             prerendered as static content
◐  (Partial Prerender)  prerendered as static HTML with dynamic server-streamed content
ƒ  (Dynamic)            server-rendered on demand


## Exit codes
tsc 0, lint 0, npm test 0, build 0.

## Batch checks
- "gateway api error" lines in build output: 0 (was 14). Lines matching error|warn: none.
- /api routes in route table: 38 lines with "ƒ ... api/", none ○ or ◐ (non-ƒ grep on api/ empty).
- Tests: 590 tests, 588 pass, 0 fail, 2 skipped.

## Secret scan
- `git diff --cached --name-only`: empty. Tracked .env files: only .env.example.
- Pattern scan (private key blocks, sk- keys, AKIA, *_PRIVATE_KEY/MNEMONIC/SECRET=value, --exclude='.env*'): 0 hits. A broader 0x+64hex scan only matched tx hashes in .batches docs (public, not keys).

VERDICT: PASS
