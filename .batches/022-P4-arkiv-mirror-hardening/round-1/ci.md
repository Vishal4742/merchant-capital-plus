VERDICT: PASS

Lane-run checks (PIPELINE §3b), 2026-11-06 10:43 IST, backend, from apps/web, after the security review fixes (69b36a5):
```
$ node --experimental-test-module-mocks --test test/gw-*.test.mjs
ℹ tests 186
ℹ pass 186
ℹ fail 0
$ npm test
ℹ tests 498
ℹ pass 496
ℹ fail 0
ℹ skipped 2
$ npm run typecheck → type errors: 0
$ npm run lint → lint exit 0
$ npm run build
✓ Compiled successfully in 936ms
```
No schema change. Tests first (c590d58, red for the right reasons), then the fix (d54eabb), then the review fixes (69b36a5; mutation-checked: ownedBy back → 9 fail, any entity adopted → 1 fail, unguarded success UPDATE → 1 fail). The batch 021 lease-lapse test now waits 5 min (the spec's new lease). Batch 024's uncommitted red tests (test/gw-dispatch.test.mjs) were held out of this run.
