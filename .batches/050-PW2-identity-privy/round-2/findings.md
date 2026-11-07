# Batch 050 round 2: findings to fix (independent review of PR #44 by whiteflow-ef, 2026-11-06)

**Status 2026-11-07:** the author session (whiteflow-f3) has ended and none of these were started; its worktree is clean at d8a99ef. The Stage 3 lead (whiteflow-ef) takes over the round-2 fixes in this worktree.

**Reproduced by the reviewer:** identity-privy-token 8/8, identity-flow 12/12.

**Sound:**
- token verification: ES256 pinned, P1363, iss/aud/exp/iat/DID, sub match, fail-closed linked_accounts;
- sessions;
- owner_count CTEs, with FOR SHARE and 40P01/40001 → 409;
- one-statement activation;
- purposes that can't be swapped.

## H1 (high): pinned approval wallets (owner decision, 2026-11-06)
**Today:** an email takeover can link an attacker wallet through Privy and approve a payout redirect. `auth-sessions.ts` replaces the wallet set at every sign-in, and `policies.ts` accepts any `wf_principal_wallets` address as the approver.

**Required:**
- A per-business set of enrolled approval wallets, e.g. `wf_approval_wallets(business_id, principal_id, wallet, enrolled_at, enrolled_by_approval)`.
- The **first** approval wallet may be enrolled only while the business has **no** active policy.
- Any later enrollment needs a signature from an already-enrolled approval wallet of an Owner.
- Approvals are accepted only from enrolled wallets.
- Enrollments are never deleted when Privy's linked set changes (keep first_seen).
- **Every** Owner, the actor included, is notified of any new link or enrollment.
- Disclose: "a solo Owner who loses the approval wallet needs support to change the policy".

**Tests:**
- an email-only takeover with a newly linked wallet → approval refused;
- the enrolled-wallet endorsement path works;
- two enrollments at the same time.

## Medium
- **M1:** idempotent replays must return the stored answer.
  - Read `wf_idempotency` (same key and hash → stored response) **before** the domain write, and keep the plain INSERT for races.
  - Fix test 10's vacuous replay: assert that a successful replay returns the original 201/200.
  - Add the activatePolicy idempotency key (L3).
- **M2:** privacy and enumeration in member management.
  - Today an Owner who adds someone by public wallet then sees their email and all linked wallets, and 404 vs 201 reveals whether that person has signed up. There is no rate limit on adds.
  - Fix: members see other members' email and linked wallets only for themselves; others get a short wallet/identifier plus role.
  - Answer unknown and known people the same way.
  - Rate-limit adds (`sharedRateLimit`, closed).
- **M3:** resolved by the tools/stage3 harness (both R2-2 outcomes asserted).
- **M4:** resolved by the UI push, but the SRS must match what exists.

## Low
- **L1:** `businesses.ts`: refuse raw NUL/0x1F/0x7F with a character class built from code points (not an escape the editor may turn into raw characters).
- **L2:** the approval message must carry the domain and URI (EIP-4361 text, like the proof).
- **L3:** an idempotency key for activatePolicy (see M1).
- **L4:** CON-11 fails open in one edge case. Use `advanceOf(recipient) != 0n` directly; a null or unknown decode must refuse.
- **L5:**
  - pin the EC curve to P-256;
  - validate and limit `x-request-id` before it reaches audit;
  - add the NFR-17 log-grep test;
  - prune expired challenges;
  - fix test 15's title or its coverage;
  - remove the no-op CSRF assertion `a.cookie.replace("", "")`.

## Added from the batch 051 review (same patterns in these files)
- **policies.ts messages:** the quoted workspace name must lose control, format and separator characters. Use `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu`, as in 051 legacy.ts.
- **WorkspaceSettings.tsx signOut:** show a failed sign-out; don't navigate (as in 051 WorkspaceSignOut).
- **tools/stage3/identity-neon.mjs `urlFor`:** a malformed DATABASE_URL must not print itself.
- **app/merchant/settings/page.tsx:**
  - retitle the "Legacy dashboard sign-in (wallet)" details;
  - replace the SIWE `SignOut` with `WorkspaceSignOut`;
  - remove the SIWE copy.
  - Review 051's condition: this lands before or with the merge to main, or is listed as a known issue.

## SRS (docs; claude-research applies)
- Amend the NFR-8 row for `/sign-in`, and note that /checkout and /pay already allow Privy for the opt-in payer sheet (2.3).
- FR-BIZ-4 step-up text: a purpose-bound Owner approval ≤ 5 min from an **enrolled** approval wallet.
- Add 3.1 to Changes/Status with a real time.
- Fix "recovery is Privy email login": wallet-only accounts exist, and email recovery can't change a policy (H1).
