VERDICT: PASS

Lane-run checks (PIPELINE §3b), 2026-11-06 09:15 IST, backend (main merged at 2365f31, incl. claude-frontend's announce-paid fix), from apps/web:
```
$ node --experimental-test-module-mocks --test test/gw-*.test.mjs
ℹ tests 149
ℹ pass 149
ℹ fail 0
$ npm test
ℹ tests 424
ℹ pass 422
ℹ fail 0
ℹ skipped 2
$ npm run typecheck → type errors: 0
$ npm run lint → problems: 0
$ npm run build
✓ Compiled successfully in 895ms
```
Security pass: PASS; its M1 (a regression in this batch) fixed in d112abb with a regression test, L1 docstring added. After merging main, claude-frontend's sessions-v2 tests caught two over-reaches of this batch, both fixed: USD rounds up to the cent again (only USDT is exact; the SDK/sessions convention) and the FX back-off applies only after a timeout (a fast failure retries at once).
