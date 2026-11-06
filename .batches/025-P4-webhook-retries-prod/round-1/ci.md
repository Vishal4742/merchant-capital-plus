VERDICT: PASS

Lane-run checks (PIPELINE §3b), 2026-11-06 10:47 IST, backend, from apps/web:
```
$ node --experimental-test-module-mocks --test test/gw-*.test.mjs
ℹ tests 192
ℹ pass 192
ℹ fail 0
$ npm test
ℹ tests 519
ℹ pass 517
ℹ fail 0
ℹ skipped 2
$ npm run typecheck → type errors: 0
$ npm run lint → lint exit 0
$ npm run build
✓ Compiled successfully in 2.7s
```
No schema change. Tests first (6a7e5a2: 6 red, dispatchSoon not exported), then the code (9245a90). Ceiling: the after() wiring is tested with next/server.js mocked; it isn't exercised on a live Vercel instance yet (no test delivery on Neon without a merchant endpoint we control). A daily cron on /api/v1/webhooks/dispatch stays a backstop for claude-frontend's vercel.json.
