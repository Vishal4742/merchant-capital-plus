VERDICT: PASS

# Batch 051 round 2: code re-review (independent)

**Scope:** `git diff 4cf9712..ea09453` (646adc6, 47c7453, ea09453; 18 files) and round-1 `response.md`.

**Evidence:** I exported `ea09453` from git into a scratch directory, linked to the worktree's node_modules. That gives a fresh checkout with no `tsconfig.tsbuildinfo`, and it excludes the worktree's uncommitted changes to `privy-config.ts`, `auth-sessions.ts` and `privy-token.ts`, which are not part of this review. In that checkout, with Node 26.13.0:
- `next typegen && tsc --noEmit --incremental false`: **exit 0**.
- **Order check:** I forced each declaration to be read first (a `/// <reference>` to `lib/window-ethereum.d.ts`, then one to a file importing `@privy-io/react-auth`, at the top of `next-env.d.ts`). tsc exits 0 in both orders. The fix doesn't depend on read order, which was the root cause in C-H1.
- Full web suite: **811 pass, 0 fail, 2 skipped (813)**, with `packages/`, `contracts/`, `docs/` and `arkiv/` exported beside it.
- eslint on every file changed this round: clean.

I didn't run `next build` (it is the author's evidence).

## Round-1 findings: status

| Finding | Status | Notes |
|---|---|---|
| **C-H1** (high): TS2717, typecheck red | **Resolved** | The Window augmentation moved to `lib/window-ethereum.d.ts`. `export {}` makes it a module, and the `**/*.ts` include picks it up. A clean, non-incremental tsc passes in both read orders (above). |
| **C-M1** (Settings sign-out and copy) | **Moved to f3** | See the conditions in `review-security.md` (S-M2). |
| **C-M2**: lazy seeding made results depend on test order | **Resolved** | `resetDb()` now clears `wanted` (`gw-helpers.mjs:83`). The test that only passed because of order (gw-webhooks AT-14) now links explicitly. The module-level `signedIn(...)` helpers in other files call it per request, so they still seed. The full suite passes. |
| **C-M3** (= S-M1) | **Resolved** | See the security review: the limit sits after the lookup and before recovery; the pre-RPC refusals have no ordering bug. |
| **C-L1**: unused exports | **Resolved** | `CLAIM_TTL_MS`, `NOT_LINKED`, `linkedMerchantOf` and `SQL_CLAIM` are internal; the misleading comment is gone. |
| **C-L2**: test hook in production code | **Resolved** | `setObligationsRead` is removed. `legacy-claim.test.mjs` mocks `policies.ts` with `mock.module` before importing (only the type is imported from there, so the single named export is enough). |
| **C-L3**: `available` prop and eslint-disable | **Deferred to 052**; agreed | Low; it touches 13 pages, one of them f3's. |
| **C-L4**: one name for two things | **Resolved** | The interface is now `LegacyCaller`. |
| **C-L5**: spec drift | **Resolved** (spec amended) | One leftover nit: N2 below. |
| **C-L6**: 409 for a link that exists | **Resolved** | `linkedHere` (`legacy.ts:155-158`) is used in three places: the replay of a used challenge, the pre-RPC "already linked here" short-cut, and the `claimed 0` fallback. Each returns 200 only when *this* business's row equals `c.address`, and only after the signature check (apart from the accepted S-L1 replay). A concurrent winner using the same or another challenge for the same wallet now gives the losing tab the same 200. |
| **C-L7**: stale developer docs | **Deferred to 052**; agreed | Also in the rollout notes. |
| **C-L8**: fake Request | **Kept, with a comment**; agreed | |
| **C-L9.1–.3, .5** | **Resolved** | Tests added: key-merchant mismatch → 409; audit rows for 5 mutations, plus none written on 403 and 404; the matrix now fails on a 500 except for the two capital routes (that exception is documented and owned elsewhere); harness 3e. |
| **C-L9.4** | **Covered** by browser walk f | Agreed. |

## The rewritten `LegacyAccess.tsx`: no new problems
- **Busy guard and `aria-disabled`:**
  - `busy` is derived from `step`.
  - `linkMerchantWallet` calls `onStep` before its first `await`, so `busy` turns on in the same click.
  - React flushes discrete-event updates before the next click, so a second press reaches the `if (busy) return` guard.
  - `WalletSetup` errors are thrown before `setStep`, so they never leave the button stuck.
  - Focus stays on the button, and the Tailwind `aria-disabled:` styles apply only when `aria-disabled` is `"true"`.
- **The 409 re-read:**
  - `void load()` refreshes the status without passing through "loading".
  - If the workspace turned out to be linked (for example from a second tab), the linked view replaces the form and the stale error is no longer shown.
  - For `TAKEN` and `EXPIRED` the form stays, with its message.
  - If the re-read returns 401, the panel correctly switches to "signed out".
- **`linkProblem`:**
  - Server messages pass through as they are, because they are already written for people.
  - EIP-1193 4001 and -32002 match the `code` fields of viem's `UserRejectedRequestError` and `ResourceUnavailableRpcError`.
  - There is no fee or funds wording.
- **`WorkspaceSignOut`:** covered under S-L3 in `review-security.md`. A double click only sends two sign-outs, which is harmless.
- **The always-present `role=status` live region** is good practice.

## New nits (not blocking)
- **N1:** `components/WalletPay.tsx:17` still says "window.ethereum is typed by the global in components/merchant/SignIn.tsx". Point it to `lib/window-ethereum.d.ts` the next time that file is touched (batch 052).
- **N2:** spec A.3.8 still says the same 200 comes from "this consumed challenge". Since C-L6, the code returns it whenever this workspace is linked to the wallet asked for, through any challenge. Align the wording.
- **N3:** the narrower `PROMPT_UNSAFE` set; see N1 in `review-security.md`. It is optional.
- **N4 (process; I agree with `response.md`):** with `"incremental": true`, a local or pre-push `tsc --noEmit` can pass from a stale `tsconfig.tsbuildinfo`. The proposed one-line hook change (`--incremental false`, or deleting the cache first) is worth sending to the owner of `tools/githooks/pre-push`.

## Deferrals
I agree with all of them: C-L3 and C-L7 to batch 052, C-M1/S-M2 to f3, and tester 4 to Stage 4. The S-M2 condition from the security review applies: f3's fix lands with or before the merge to `main`, or the gate packet lists it as a known issue.
