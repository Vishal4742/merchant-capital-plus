# 037-P5-shared-relayer-limits
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request: claude-research 16:11 + 16:35 (human 16:09 "fix the other things", 16:34 "give other sessions work also"): FR-REL-10 (SRS v2.1) shared send lock, daily budget, per-payer limits across instances. Cutoff 20:00, else after G5.
Mode: phase mode
Money: yes (the relayer send path)
Log:
- 16:45 batch started (037: 031-036 are claude-research's). Spec: lease row + fencing over Neon HTTP (same driver/version as web), PGlite tests, own least-privilege role.
- 17:0x RED cdfba6b, GREEN c67f7e3: 69/69, tsc 0; mutants (no lock / no replay) killed by the right tests
- 17:0x security round 1 PASS (M1 DB-clock lease, M2 committed role grants, L1 query timeout + release on failed acquire, L2 lost reserve response, L3 settle retry, L4 /health uncached DB read, L5 cause message + fail-closed booleans, L6 concurrency check on Neon at deploy). Fold M1, M2, L1, L3, L5 now; L2/L4 noted; L6 in the deploy check. Holding edits until review-code lands.
- 17:0x review-code round 1 PASS (M1 mid-request DB failure untested, M2 no query timeout, L3 in-lock order, L4 6 round trips, L5 lost acquire answer, L6/L7 test tightening, L8 settle+ban, L9 grants in repo, L10 layout).
- 17:2x fixes in one pass: times from the DB clock (sec M1), 5 s query timeout (code M2/sec L1), release on a failed acquire (L5/L1), settle retried once + alert names the ban (L3/L8), StoreError keeps the cause name only + fail-closed booleans + canary test (sec L5), db/002_relayer_role.sql with column-level grants + a PGlite test relaying as that role (sec M2/L9), tests: reserve-write failure, post-broadcast failure, lost acquire answer, too-slow message, B timings. Spec: in-lock order and test location recorded. Deferred: sec L2 (lost reserve answer → 503 then replay; web re-signs), sec L4 (/health uncached DB read), code L4 latency (measure on the live sale). Deploy script: role from the committed file, neon_superuser check, 3-way live lease race (sec L6). 74/74, tsc 0; canary mutant killed.
- Ask claude-research: ARCHITECTURE §3 "Postgres advisory lock" → lease row with fencing (FR-REL-10).
- 17:1x ci round 1 PASS (npm ci, 74/74, tsc 0, secret scan clean, .vercelignore ok, api/ never reaches pglite). Deploy smoke (every store statement + 3-way lease race) dry-run on PGlite ok. Human gate next.
- 17:1x human gate: "Ship + deploy (Recommended)" (merge, deploy script: tables + restricted role + DATABASE_URL, relayer redeploy, /health; no money).
