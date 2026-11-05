VERDICT: PASS

Batch 001-P1-web-rail-proofs, round 3. Lane claude-frontend, apps/web only (no contracts, so no forge).
Ran in a scratchpad copy of apps/web (no node_modules/.next, `npm ci`), so the :3100 server was untouched.
Copy: /private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/web

## npm ci
exit 0 (audit advisory notice only)

## npx tsc --noEmit
First run on the fresh copy: exit 2, `app/layout.tsx(20,50): error TS2304: Cannot find name 'LayoutProps'.`
Cause: `LayoutProps` is a Next 16 global generated into `.next/types` by `next build`; a copy with no `.next` does not have it. Not a code defect.
Rerun after `npm run build` (types generated): exit 0, no output.

## npm run lint
exit 0 (eslint, no findings)

## npm test
exit 0
```
ℹ tests 11
ℹ suites 0
ℹ pass 11
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```
(Only warnings: experimental module mocking, MODULE_TYPELESS_PACKAGE_JSON.)

## npm run build
exit 0
```
▲ Next.js 16.4.3 (Turbopack)
✓ Compiled successfully in 1168ms
  Finished TypeScript in 1469ms ...
✓ Generating static pages using 5 workers (4/4) in 151ms
Route (app)
┌ ○ /
└ ○ /_not-found
```

## Secrets
- `git diff --cached --name-only`: 0 staged files.
- Pattern grep (PRIVATE KEY, sk-, AKIA, ghp_, xox, 0x+64 hex, mnemonic, seed phrase) over apps/web and the batch folder: only hits are public constants: USDT domain separator and RECEIVE_WITH_AUTHORIZATION typehash in apps/web/test/guest-wallet.test.mjs, NYM_WORKER_HASH in apps/web/lib/anon.ts, and the same hashes quoted in round-1/round-2 markdown. No keys.
- No `.env*` files in apps/web or the batch folder (apps/web/.gitignore ignores `.env*`; root .gitignore ignores `.env`).
- Root .env values (counted, never printed): 0 of 13 values of length >= 8 appear anywhere in apps/web or the batch folder.
