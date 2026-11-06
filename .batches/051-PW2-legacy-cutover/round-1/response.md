# Batch 051 round 1: author response (whiteflow-ef)

Inputs:
- `review-security.md` (VERDICT: PASS)
- `review-code.md` (VERDICT: FAIL on C-H1)
- `test.md` (VERDICT: PASS, browser walk a–i)

Fixes are in commits 646adc6 and 47c7453, plus the round-1 follow-up commit that carries this file.

| Finding | Action |
|---|---|
| **C-H1** (high): clean `tsc` failed with TS2717 on `Window.ethereum` | **Fixed.** The global declaration moved from `SignIn.tsx` to `lib/window-ethereum.d.ts`, where the clash with Privy's `ethereum?: any` is a declaration-file clash that skipLibCheck ignores in either read order. Verified with `rm tsconfig.tsbuildinfo && tsc --noEmit --incremental false`: exit 0. The earlier local and pre-push passes came from the incremental cache; see Process note. |
| **S-M1 / C-M3**: no rate limit on claim; the RPC read ran before the uniqueness check | **Fixed.** `legacy-claim-submit:<principal>` allows 10/min ("closed"). Before the chain read: a wallet linked elsewhere → 409; linked here → the same 200; this workspace linked to another wallet → 409. Tests check the 12-attempt sequence (403/503 ×5, then 429 ×2, 5 chain reads) and zero chain reads on refusal. |
| **S-M2 / C-M1**: the Settings page still uses the SIWE `SignOut` and SIWE copy, and the link step sits under "Legacy dashboard sign-in" | **Owner whiteflow-f3** (`app/merchant/settings/page.tsx`, outside this batch's files). Sent to f3 before the review, with the same two asks. The header sign-out (`Account`) works and is tested in walk h. |
| **C-M2**: lazy seeding made test results depend on order | **Fixed.** `resetDb()` now clears `wanted`. This exposed one test that only passed because of order: the gw-webhooks AT-14 test, which now links its wallet explicitly (`seedWorkspace(MERCHANT)`). |
| **S-L1**: the replay doesn't re-check the signature | **Accepted.** No state changes and nothing is disclosed beyond what the same Owner's `GET /api/v2/legacy` shows. |
| **S-L2**: unsafe Unicode in the quoted workspace name | **Fixed.** NEL, U+2028/2029 and the bidi controls (U+202A–E, U+2066–9) become spaces, matched by a code-point list. Tested. f3's `policies.ts` messages have the same pattern; I'll pass that on. |
| **S-L3**: `WorkspaceSignOut` hid a failed sign-out | **Fixed.** It shows "We couldn't sign you out. Try again." and stays on the page. The same pattern in `WorkspaceSettings.tsx:91` belongs to f3 and will be passed on. |
| **S-L4**: the harness could print the URL | **Fixed.** A malformed `DATABASE_URL` prints a fixed sentence only. f3's `identity-neon.mjs` `urlFor` has the same pattern; I'll pass that on. |
| **C-L1**: unused exports | **Fixed.** `NOT_LINKED`, `CLAIM_TTL_MS`, `linkedMerchantOf` and `SQL_CLAIM` are now internal, and the "exported for the harness" comment is gone. |
| **C-L2**: test hook in production code | **Fixed.** `setObligationsRead` is removed; `legacy-claim.test.mjs` mocks `policies.ts` `readV1Obligations` with `mock.module`. |
| **C-L3**: leftover `available` prop and eslint-disable | **Deferred to batch 052** (SIWE retirement; spec being written by whiteflow-a8). Removing it touches 13 pages, one of them f3's. |
| **C-L4**: one name for two things | **Fixed.** The interface is now `LegacyCaller`. |
| **C-L5**: spec drift (nonce 409, error wording, `createKey`) | **Spec amended** (A.3.1, A.3.3–5, A.3.10, B keys, C errors). Wallet errors now use a local signing-specific mapping, not `walletProblem` or `walletError` (tester finding 2). |
| **C-L6**: a 409 for a link that already exists | **Fixed.** When the statement claimed nothing, the answer is the same 200 if this workspace is linked to the wallet asked for (`linkedHere`). |
| **C-L7**: stale developer docs | **Deferred to batch 052** (`lib/docs-reference.ts:415`, `app/docs/page.tsx:583`, plus the new 409 for unlinked secret keys on webhooks GET/POST). Also listed in the gate packet's rollout notes. |
| **C-L8**: the internal Request in `dashboardWorkspace` | **Kept, with a comment saying why** (one copy of the session check). A token-taking variant would live in f3's `auth-sessions.ts`; I'll suggest it to f3. |
| **C-L9.1**: key merchant ≠ business link untested | **Fixed** with a test (hand-edited key → 409). |
| **C-L9.2**: audit asserted for one route only | **Improved.** Audit is now asserted for keys create/revoke, links create/cancel and pages create. A refused (403) or failed (404) call writes nothing. The rest (webhooks, vouchers, refunds, capital) need network fixtures; I checked by hand that every mutation calls `auditV1`, as the reviewer did. |
| **C-L9.3**: the matrix counted 500 as allowed | **Fixed.** A 500 now fails, except on the two capital routes. Those answer 500 (not 502) when RPC/Arkiv is unreachable; that is pre-existing service behaviour in `capital.ts`/`capital-arkiv.ts`, recorded as a follow-up for those files' owner. |
| **C-L9.4**: page-level hiding untested in unit tests | Covered by browser walk f in `test.md` (Viewer sees "Only Owners can see API keys and webhooks." on both pages). |
| **C-L9.5**: claim racing a demotion | **Added** as harness case 3e. On Neon: demote 200, claim 403, nothing linked, challenge unused. |
| **Tester 1**: `/merchant/connections` overflowed at 360 px (pre-existing) | **Fixed** (`grid-cols-[minmax(0,1fr)]`). |
| **Tester 2**: fee wording in link errors | **Fixed** (see C-L5). |
| **Tester 3**: failed sign-out ignored | **Fixed** (see S-L3). |
| **Tester 4**: a Viewer is offered create forms on links and overview | **Deferred.** Role-aware forms across the legacy dashboard are a Stage 4 UI task; the server refuses with 403 (tested). |
| **Tester 5**: sign-out target too small | **Fixed.** It is now `min-h-10` (40 px). |
| **Tester UX notes** | Copy changed: "Used this dashboard with a merchant wallet before? Link that wallet…", "belong to this workspace" instead of "move into", and "There's no transaction and no funds move". Focus stays on the button while it works (`aria-disabled` instead of `disabled`). An always-present `role=status` live region carries the steps. A 409 re-reads the status, for a second tab. The account badge showing the workspace name and role is deferred (Stage 4 UI). Settings-page notes are f3's. |
| **Tester: a batch-050 leftover file holding a database URL copy** (`C:/Users/nothi/tmp-pw/.dburl`), deleted unread | Reported to the human in this round's summary. Not printed or committed, so no rotation is needed. |

## Process note (for the gate packet)
`apps/web` has `"incremental": true`. A local `tsc --noEmit`, including the pre-push hook's, can therefore pass from a stale `tsconfig.tsbuildinfo` while a fresh CI checkout fails. From now on this batch verifies typecheck with the cache removed. Proposed one-line fix to the hook, for whoever owns `tools/githooks/pre-push`: run `tsc --noEmit --incremental false`, or delete `tsconfig.tsbuildinfo` first.
