# Batch 050 round 2: fixes for the independent PR #44 review (whiteflow-ef, Stage 3 lead, takeover; tracker D16)

The author session (whiteflow-f3) ended with round 2 unstarted. The findings are in `findings.md`. Each one below lists its fix, its commit and its evidence. All fixes are on `wf/stage3-identity`.

| Finding | Fix | Commit | Evidence |
|---|---|---|---|
| **H1** pinned approval wallets (owner decision) | **Schema:** `wf_approval_wallets`, never deleted when Privy's linked set changes, and a new challenge purpose `enroll`. **Activation:** the first activation pins its approval wallet in the activation statement; afterwards both the approval issue and the activation's one-statement re-check accept only an enrolled wallet of the approving Owner. **Enrollment:** `/api/v2/business/approval-wallets{,/confirm}`. An enrolled wallet of a current Owner signs an EIP-4361 endorsement; one statement covers the enrollment, the notices to every Owner (requester included) and the audit row; the endorser's Owner is re-checked at confirm (FOR SHARE on both memberships). **Notices:** a wallet newly linked at sign-in notifies every Owner of the member's workspaces. **UI:** the approver list and an Approval wallets panel. **Disclosure** in the UI: a solo Owner who loses every approval wallet needs support. | 5ced1cf, 7c2cf46, 0ba75b6 | identity-flow H1 tests: an email-takeover wallet is refused; the endorsement path works; the endorser must be a current Owner. Neon: E1 (one endorsement ×3 gives 1 enrollment and the same 200) and E2 (staged demotion of the endorser gives 403, nothing enrolled). |
| **M1** replays must return the stored answer | `storedAnswer()` reads `wf_idempotency` before the write; the plain INSERT still settles races. | 7cd899f | identity-flow M1: add, role and remove replays return the original answer; the same key with another payload is 409. RED before: 409s. |
| **L3** activatePolicy idempotency | Required `idempotencyKey`, read-first, record in the activation statement. A concurrent duplicate gets the winner's version. The UI sends one key per signed pair. | 7cd899f | Same-key replay: the same 201. New key: 409 (consumed). Missing: 400. Neon case 3: 200×3, one version. |
| **M2** member privacy and enumeration | Each member sees their own email and wallets and a masked label for others. Adds are limited to 10/min per Owner (closed). | c83bb57 | identity-flow M2 |
| M2 (residual) | Whether a wallet or email has signed up is still visible to an Owner who adds it, because the member list shows success. A truly uniform answer needs pending invites (out of scope). The rate limit bounds enumeration. | n/a | For the re-reviewer to judge |
| **L1** control bytes in businesses.ts | Already fixed in round 1 (char-code check, b7e3e48). | n/a | No control bytes in the source |
| **L2** approval message lacks domain/URI | The approval is EIP-4361, as the proof is (domain/URI, chain, nonce, expiry; resources bind business, policy hash and proof). Workspace names in both messages lose control, format and separator characters. | cd67e05 | identity-flow round-2 L2 test |
| **L4** CON-11 failed open | `capital.ts v1Obligations` mirrors `CapitalMarket.hasClaimsOn`: `advanceOf != 0` (covers `liensOf`), or an uncancelled, unsettled invoice claim with units outstanding. Failed or odd reads throw (503), and so does a book larger than the 200 offers read. | 7b28225 | capital-obligations 5/5 (RED 0/5 first) |
| **L5** | P-256 pinned (other curves refused). Expired unused challenges pruned. NFR-17 log/audit grep test added. Test 15 now covers all 15 v2 routes. The no-op CSRF assertion removed. (x-request-id was already validated by `requestIdOf`.) | cfadbc5 | identity-privy-token 9/9; identity-flow 19/19 |
| 051-review patterns in these files | Prompt-safe names (cd67e05); WorkspaceSettings sign-out failure shown (7c2cf46); identity-neon `urlFor` never prints the URL (7cd899f). | as listed | |
| Settings page (SIWE sign-out/copy) | Belongs in batch 051, after the cutover: this branch is below it, where SIWE is still the legacy sign-in and `WorkspaceSignOut` doesn't exist. To be done in 051 at rebase. | n/a | Listed in 051 GATE.md |
| SRS text | Drafted in `srs-amendments.md` for claude-research / the human (lanes don't edit SRS). | n/a | |

## Found while fixing (not in the review)
- **Promoting a member to Owner always failed.** The promote form sent 11 parameters but used 10; Postgres answers `08P01`, which `isDbDown` reports as "database down" (503). Fixed by using `$11` in that form (5ced1cf). Covered by the H1 endorser test.
- **Test-order leak.** Test 15 installed a fresh database, but the file kept reading the old handle, so later tests that read `pg` directly saw a stale database. Fixed (5ced1cf).

## Evidence summary (cfadbc5)
- identity-flow 19/19, identity-privy-token 9/9, capital-obligations 5/5.
- Neon harness `tools/stage3/identity-neon.mjs`: 7/7 on wf_s2_web, through the production driver.
- Full web suite, clean typecheck, lint and build: see `ci.md` after the run.
