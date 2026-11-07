# Batch 050 round 3: fixes for the round-2 independent review (whiteflow-ef, Stage 3 lead)

Round 2's `review-security.md` was VERDICT FAIL (S-H1) and its `review-code.md` VERDICT PASS. All fixes are in **e065fb3** on `wf/stage3-identity`.

**The independent re-review of round 3 is OUTSTANDING.** Reviewer agents were unavailable ("credit balance is too low"). The supervisor (whiteflow-8c, 2026-11-07) decided to record it here rather than wait. #44 is not merged before submission. **This batch can't close until a non-author reviewer writes `round-3/review-security.md` with VERDICT PASS.**

| Finding | Fix | Test |
|---|---|---|
| **S-H1** (high): a removed or demoted Owner's approval wallet worked again when they came back | `wf_approval_wallets.revoked_at` is set in the remove and demote statements (`businesses.ts` REVOKE: target membership → wallet rows → business row), with notices to every Owner, the person included. The approval issue and the activation statement both need `revoked_at IS NULL`; so does an endorser. Coming back needs a fresh endorsement: SQL_ENROLL's `ON CONFLICT` revives only a revoked row, and the challenge is consumed only if it enrolled. The list shows only active wallets of current Owners. | identity-flow "round 3 (S-H1)": an approval issued before demote+promote is refused by the activation statement (409) and up front (403); a fresh endorsement restores it; removal + re-add is refused again; revoke notices go to both Owners |
| **S-M1**: notices weren't readable; the pin wrote none | `GET /api/v2/me/notifications` (plain sentences, newest 50). The first-activation pin notifies every Owner, the actor included. | "round 3 (S-M1)" |
| **C-M1**: concurrent identical add/remove answered 409/404 | Both paths read the stored answer before refusing. | "round 3 (C-M1)" (Promise.all) |
| **C-M2**: tests would pass a broken endorser check or a broken SQL_ACTIVATE H1 clause | New tests: the endorser is re-checked with requester ≠ endorser; a revoked approval is refused by the activation statement itself. | "round 3 (C-M2)", "round 3 (S-H1)" |
| **S-L2**: Viewers saw the approver in full | Non-Owners get `0x1234...abcd`. | "round 3 (lows)" |
| **S-L3**: the endorsement didn't say who asks | The statement names the asking Owner by their masked label. | "round 3 (lows)" |
| **C-L1**: add replays re-looked-up and spent rate budget | The hash covers the request as sent, and the stored answer is read before the lookup and the rate limit. | "round 3 (lows)" |
| **C-L2**: stale wallet pick in the panel | Picks are derived from the current lists. | lint (react-hooks) |
| **C-L3**: ex-Owners' wallets listed | List and endorser options show active wallets of current Owners only. | "round 3 (S-H1)" |
| **C-L4**: 08P01 was reported as "database down" | `isDbDown` excludes 08P01 (it stays a 500). | "round 3 (lows)" |
| **C-L6**: unlinked wallet answered "expired" | A 400 "no longer linked"; the challenge stays usable. | "round 3 (lows)" |
| **C-L7**: owner of the settings-page fix | Done in batch 051 (ee67132, settings page after the cutover). | n/a |

**Accepted residuals, for the re-reviewer:**
- **S-L1:** labels still show an email domain, or a short prefix of a wallet-only member's first wallet. The 10/min add limit is per account.
- **S-L4:** CON-11 reads aren't pinned to one block; listed-but-unfunded invoice offers aren't counted (they match `hasClaimsOn`).
- **C-L5:** the CHECK change inside `CREATE TABLE IF NOT EXISTS` doesn't reach databases that already applied round-1 053 (053 is unmerged; the harness rebuilds).

## Evidence (e065fb3)
- identity-flow 24/24.
- Full web suite (Node 26): 811 tests, 809 pass, 0 fail, 2 skipped.
- `tsc --noEmit --incremental false` and eslint on the changed files: clean.
- Neon harness `tools/stage3/identity-neon.mjs` on wf_s2_web: 7/7, including E1 (one endorsement ×3) and E2 (confirm vs the endorser's demotion → 403, nothing enrolled), on the new SQL_ENROLL.
