VERDICT: PASS

# Batch 051 round 2: security re-review (independent)

**Scope:** `git diff 4cf9712..ea09453` (646adc6, 47c7453, ea09453), checked against round-1 `response.md`.

**How I ran it:** I exported `ea09453` from git into a scratch directory, linked to the worktree's node_modules. That checkout has no incremental cache and none of the worktree's uncommitted files (`privy-config.ts`, `auth-sessions.ts`, `privy-token.ts` are modified locally and are not part of this review).

**Evidence:**
- Full web suite: 811 pass, 0 fail, 2 skipped (813). The run includes the new S-M1, S-L2 and key-mismatch tests.
- eslint on the changed files: clean.

I connected to no remote database, read no `.env` file, and deleted the scratch directory.

**Result:** no critical or high security findings. S-M2 is still open and has moved to f3; see the deferrals section for the condition attached.

## Round-1 findings: status

| Finding | Status | Evidence |
|---|---|---|
| **S-M1**: no claim rate limit; chain read before the uniqueness check | **Resolved** | See "S-M1 in detail" below. |
| **S-M2**: the Settings "Sign out" button doesn't sign out | **Open, moved to f3** (the file is f3's) | Condition under "Deferrals". |
| **S-L1**: replay doesn't re-check the signature | **Accepted**; I agree | No state change. It discloses only what the same current Owner sees on `GET /api/v2/legacy`, and the caller must hold that Owner session. |
| **S-L2**: unsafe Unicode in the quoted name | **Resolved for the stated risk** | `promptSafe` (`legacy.ts:27-28`) replaces LF, CR, NEL, U+2028/2029, U+202A–E and U+2066–9. The test checks the message keeps exactly one `Chain ID:` line. One nit below. |
| **S-L3**: failed sign-out hidden | **Resolved** | `WorkspaceSignOut` (`LegacyAccess.tsx:184-212`) shows "We couldn't sign you out. Try again." and stays on the page, both on a non-OK answer and on a network error (the bare `catch` covers both). Retrying after a revocation whose answer was lost is safe: `signOut` updates nothing and still clears the cookie. |
| **S-L4**: harness could print the database URL | **Resolved** | `legacy-neon.mjs:33-40` prints a fixed sentence. Round 1 confirmed the old `TypeError` echoed its input. |

### S-M1 in detail
1. **Where the limit sits:** `legacy-claim-submit:<principal>` (10/min, closed) is at `legacy.ts:193`. It comes after the bound challenge lookup and the expiry check, and before `recoverSigner`.
   - Unknown, used and expired nonces never touch the limiter. They cost one indexed read and do no recovery or RPC.
   - Wrong-signer attempts count toward the limit.
2. **Pre-RPC refusals:** after the signature is verified, `legacy.ts:196-205` reads the business row and any row holding this wallet (`id = $1 OR legacy_merchant = $2`, at most 2 rows, because `legacy_merchant` is UNIQUE).
   - Wallet linked to another workspace → 409 `TAKEN`.
   - Wallet linked here → the same 200.
   - This workspace linked to another wallet → 409 `ALREADY_LINKED`.
   - No path reaches the chain read for a wallet or workspace that is already linked.
3. **Tests:**
   - 12 alternating attempts give 403/503 ×5, then 429 ×2, with exactly 5 chain reads.
   - A wallet linked elsewhere gives 409 with 0 reads.
   - "Linked here" gives 200 with 0 reads.
4. **What is left:** the round-1 scenario (looping one signed challenge for a wallet linked elsewhere) now costs 0 RPC calls. A chain read now happens only on an attempt that can actually link, or when the RPC is already failing (503), and both are capped at 10 a minute per principal.

## The fixes themselves: no new problems
- **Could a refusal answer 200 for a wallet linked to someone else?** No. The 200 short-cut needs `holder.legacy_merchant === c.address && holder.id === owner.businessId`, and the UNIQUE index allows only one holder. The post-statement fallback `linkedHere` compares this business's own row to `c.address`. Both 200 paths run only after this request's signature over this principal's challenge was verified.
- **Does anything leak before the signature is verified?** No. Before recovery, the caller can learn only:
  - 409 for an unknown, foreign or expired nonce (one answer for all);
  - 429;
  - the S-L1 replay for a challenge already used, which is about the caller's own workspace only.

  `TAKEN` (that the wallet is linked elsewhere) is revealed only after the caller proved control of that wallet. The challenge endpoint still never reveals link status.
- **Concurrency is unchanged.** The pre-check is a plain read. `SQL_CLAIM` still enforces the unique index and `legacy_merchant IS NULL` under races; a race lost after the pre-check still ends in 23505 → 409 or `claimed 0`. Harness 3e (claim against a demotion) fills round 1's C-L9.5 gap; on my trace it is symmetric with 3d.
- **CON-11 still holds.** The only path that can link still reads obligations first. The new 200 short-cuts link nothing and return the stored `v1_obligations`.
- **`PROMPT_UNSAFE`:** iterating with `Array.from(text)` and checking `charCodeAt(0)` is correct for the BMP code points listed. Astral characters yield a high surrogate, which is not in the set and so passes through unchanged. The source contains no invisible characters.
- **C-H1 fix (`lib/window-ethereum.d.ts`):** this changes types only and has no runtime effect.

## Low / nits (not blocking)
- **N1 (PLAUSIBLE, nit):** the S-L2 list is narrower than round 1's suggestion (`\p{Cc}\p{Cf}\p{Zl}\p{Zp}`).
  - Still let through: LRM/RLM/ALM (U+200E, U+200F, U+061C), zero-width characters (U+200B–D, U+2060–4, U+FEFF), the interlinear annotation characters (U+FFF9–B) and the astral tag characters (U+E0000–E007F).
  - None of these can start a line or override direction, so the "reshape the prompt" risk is covered.
  - If wanted: `name.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")` would also cover the astral tag characters and still keep the source ASCII.
- **N2 (still informational, from round-1 I1):** the `SQL_CLAIM` comment still says the lock order matches member changes, without noting that `b` takes FOR UPDATE (`legacy_merchant` is UNIQUE). My round-1 trace still holds: no deadlock pair.

## Deferrals: do I agree?
- **S-M2 → f3:** I agree on ownership, since `app/merchant/settings/page.tsx` is f3's file. **Condition:** this batch causes the regression (the page now opens on `wf_session`, which the old button doesn't touch), so f3's fix should land before or with the 050/051 stack's merge to `main`, or be listed in the gate packet as a known issue. The header sign-out works and is tested (walk h), which is why I don't fail on it.
- **Tester 4 → Stage 4:** I agree. Viewers are offered create forms, but the server refuses them with 403 (tested), so this is UX, not authorization.
- **C-L3 / C-L7 → batch 052:** no security effect. The only issue is documentation accuracy for the new 409 on unlinked secret keys, which is also in the rollout notes.
