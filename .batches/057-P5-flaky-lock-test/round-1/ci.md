CI round 1, batch 057-P5-flaky-lock-test, branch p5-flaky-lock-test (59a0b5d on e5a0364)

Diff: .batches/057-P5-flaky-lock-test/{batch,spec}.md and apps/web/test/sessions-db.test.mjs only.

1. npx tsc --noEmit (apps/web): exit 0, no output
2. npm run lint (apps/web): exit 0, eslint no findings
3. npm test (apps/web): exit 0. tests 703, pass 701, fail 0, cancelled 0, skipped 2, duration 40s
4. npm run build: SKIPPED. Confirmed nothing outside apps/web/test changed (plus .batches docs), so the build cannot change.
5. Spec criterion: `node --experimental-test-module-mocks --test --test-name-pattern "lapsed lock" test/sessions-db.test.mjs` x20: failures 0/20
6. Secret scan (pre-push pattern via git grep, .env excluded): no matches. Staged files: 0. Only tracked .env* file is .env.example.

Note: the shell's exit-code capture for step 3 was lost; fail 0 and a clean summary confirm it passed.

VERDICT: PASS
