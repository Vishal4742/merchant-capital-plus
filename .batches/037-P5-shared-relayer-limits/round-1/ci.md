VERDICT: PASS

Head 25a50ab (merge of origin/main into relayer, after 37590ff). Worktree /Users/vg890/ethglobal-relayer.

## apps/relayer: npm ci
exit 0
```
added 19 packages, and audited 20 packages in 2s
10 packages are looking for funding
found 0 vulnerabilities
```

## apps/relayer: npm test
exit 0
```
ℹ tests 74
ℹ suites 0
ℹ pass 74
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 14878.217292
```
(last test: "FR-REL-10: as the mcplus_relayer role (db/002_relayer_role.sql) a sale relays end to end, and other tables are refused" passed. The "storage error" and "ALERT" lines in the log are expected output of the failure-path tests.)

## apps/relayer: npx tsc --noEmit
exit 0, no output.

## Secret scan
Diff: `git diff cdfba6b~1 HEAD -- apps/relayer .batches/037-P5-shared-relayer-limits` (lock file excluded), added lines only. Patterns: PEM private key headers, postgres URLs with user:pass@, npg_ tokens, sk- keys, 0x + 64 hex, password literals.
- Matches: none (grep exit 1).
- `.env*` files in the diff's file list: none (exit 1).
- No .env file was read or grepped.

## .vercelignore
Contents: `.env`, `.env.*`, `node_modules`, `test`, `dev.ts`. Still excludes test/, dev.ts and .env*.

## pglite isolation
`grep -rnE "db/pglite|@electric-sql/pglite|pglite" apps/relayer/api` returned no matches (exit 1). Nothing under api/ imports db/pglite.ts or @electric-sql/pglite.
