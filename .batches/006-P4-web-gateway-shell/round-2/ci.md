VERDICT: PASS

# CI, batch 006 round 2 (claude-frontend; run by the lane under PIPELINE §3b, 06:18)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 (eslint, no findings) |
| Unit tests | `npm test` | exit 0: tests 293, pass 290, fail 0, skipped 3 (LIVE-only FX tests) |
| Build | `npm run build` at 05:58, after the last source edit at 05:57 | exit 0, 26/26 pages generated; BUILD_ID 05:58 |
| NFR-12 | Chrome `encodedBodySize` on /checkout (tester round 2) | 191,149 B ≤ 204,800 B |
| Live chain | AT-1 on this build (G2, human-approved) | tx 0x7e03b5d0c52b6b7d941845b364f78875719c481fc7d4b353187038b504b37a11, block 12329601, status success |

**Secrets.** The scratch files `.shopkey` and `.authsecret` (flagged by security round 2) were deleted unread. No key is in any tracked file, per security round 2's grep.

**Not re-run.** The build wasn't re-run because :3100 serves this `.next` and a rebuild would replace it under the live server. No source file changed after 05:57.
