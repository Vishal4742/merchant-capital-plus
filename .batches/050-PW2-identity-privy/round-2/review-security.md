VERDICT: FAIL

# Batch 050 round 2: independent security review (PR #44, `wf/stage3-identity`, d8a99ef..542487e)

**Reviewer:** an independent subagent, review only (no product edits), 2026-11-07.

**Scope:** the round-2 commits 7b28225..542487e.
- `lib/server/{approval-wallets,policies,businesses,auth-sessions,privy-token,capital}.ts`
- `db/053_identity.sql`
- the v2 approval-wallet and policy routes
- `WorkspaceSettings.tsx`
- the three test files
- `tools/stage3/*`

**What I ran:**
- `node --experimental-test-module-mocks --test test/identity-flow.test.mjs test/identity-privy-token.test.mjs test/capital-obligations.test.mjs` on Node 26.13.0 passes **33/33** (identity-flow 19, privy-token 9, capital-obligations 5).
- Seven throwaway PGlite experiments, run against the real v2 route handlers from a directory outside the repo (EXP-A to EXP-G, quoted below). The directory is deleted.
- The Neon harness was **not** run: I was told not to connect to any remote database. Its claimed 7/7 is unverified by me.

The verdict is FAIL because of one high finding (S-H1). The rest of the H1 design holds up (see "Checked and sound").

---

## High

### S-H1: a removed or demoted Owner's approval wallet comes back to life when they are re-added or re-promoted, with no endorsement
**CONFIRMED (reproduced, EXP-A)**

**Where:**
- `apps/web/lib/server/businesses.ts:289` (removeMember) and `:256-257` (the demote form) never touch `wf_approval_wallets`.
- `apps/web/lib/server/policies.ts:137` (`approvalWalletAllowed`) and `:208` (the SQL_ACTIVATE `ok` CTE) accept any enrollment row of the approving principal, with no regard to when or whether that principal stopped being an Owner.
- `apps/web/lib/server/approval-wallets.ts:41-42`: the list still shows the dormant rows.

**Failure scenario (reproduced on PGlite through the real routes):**
1. Alice creates the workspace and pins wallet a1 at version 1.
2. Bob is added as Owner, and a1 endorses Bob's wallet b1.
3. Alice removes Bob (for example after a dispute). `GET /approval-wallets` still lists b1.
4. Someone takes over Alice's Privy login (email) and links their own wallet. That wallet is correctly refused as an approver. From the hijacked session they re-add Bob as Owner (`members:manage` needs only the session).
5. Bob approves version 2 with b1, paying out to an attacker address: **201**. Output: `EXP-A bob re-added approves: activate 201 0x7072… attacker recipient 0x7072…`.

**Who can do this:**
- A removed or demoted ex-Owner, plus a takeover of **any** current Owner's Privy login. This is the H1 threat.
- Or a current Owner who has only a login and was never enrolled, colluding with an ex-Owner.

Either way, approval power is granted back without an endorsement from an enrolled wallet of a current Owner. That defeats the owner decision ("later ones need an endorsement signed by an enrolled wallet of a current Owner"). It also defeats the usual fix for a distrusted co-owner, which is to remove them. Demotion followed by re-promotion behaves the same way.

**Fix:**
- In the same statement as `removeMember` and as the demote form, soft-revoke that principal's enrollments in the business: add `revoked_at` and `revoked_by` to `wf_approval_wallets`. Rows are still never deleted.
- Notify every Owner of the revocation.
- Require `revoked_at IS NULL` in `approvalWalletAllowed`, in the SQL_ACTIVATE `ok` clause, in the endorser check (`requestEnrollment` and the SQL_ENROLL `endorser` CTE) and in the list.
- Re-enrolling a revoked wallet then needs a fresh endorsement: `ON CONFLICT (business_id, wallet) DO UPDATE ... WHERE revoked_at IS NOT NULL` in SQL_ENROLL.
- Add a test: remove or demote an Owner, re-add or re-promote them, and their approval is refused (403) until a current approval wallet endorses them again.
- A simpler alternative: stamp `owner_since` on the membership at add-as-owner and at promote, and require `enrolled_at >= owner_since`.

## Medium

### S-M1: "every Owner is notified" isn't delivered: notices are write-only, and the first pin notifies nobody
**CONFIRMED (grep + EXP-E)**

**Where:**
- No route, page or component reads `wf_notifications`. The only SELECTs are in `test/identity-flow.test.mjs`. The rows are written at `auth-sessions.ts:60-69`, `approval-wallets.ts:115-119` and `policies.ts:221-224`.
- The pin (`policies.ts:217-220`) writes no `approval_wallet.enrolled` row.
- The `policy.activated` notice excludes the actor (`policies.ts:224`, `m.principal_id <> $2`).

**Failure scenario:**
- An attacker links a wallet after an email takeover. The `wallet.linked` row is written, but no Owner ever sees it.
- For a solo Owner, the first activation (which pins the approval wallet) leaves **zero** notice rows. Output: `EXP-E notices after first activation + pin: []`. A takeover before the first activation (trust on first use) wins the pin silently, even toward the real owner once they sign back in.
- The H1 detection half ("every Owner is notified of new links and enrollments") and FR-BIZ-4's "notifies the other Owners" exist only as database rows.

**Fix:**
- Add `GET /api/v2/me/notifications`, plus a Settings panel or banner listing unread `wallet.linked`, `approval_wallet.enrolled` and `policy.activated`.
- Have the pin also insert `approval_wallet.enrolled`, with `endorsedBy: null`, for every Owner including the actor.
- If the reader is deferred, record it in the gate as a known issue and make the SRS amendment say "recorded, not yet shown".

## Low

### S-L1: the M2 masked label still links the add identifier to other identity data
**CONFIRMED (EXP-D)**

**Where:** `businesses.ts:29-35` (`memberLabel`) and `:184-188`.

**Failure scenario:**
- An Owner adds someone by a public wallet and then sees `jo...@acme.com`: the email's domain and first two letters. A company domain names the employer.
- For a wallet-only member with two linked wallets, the label is the short form of the **other** wallet (`wallets[0]` of the sorted set). Output: `EXP-D added by 0xd2be…8621 label 0xa7c5...81b9 other wallet 0xa7c5…81b9`. Eight hex characters, together with on-chain activity, usually identify that address.
- The documented residual ("whether a wallet or email has signed up is visible") understates this. The 10/min limit is also per principal, and anyone can create a Privy account and a workspace, so Sybil accounts multiply it.

**Fix:**
- Label another member by the identifier the Owner used to add them: store `added_via` on the membership. Alternatively, use a display name the member sets.
- Never derive the label from wallets other than the one used to add them.
- State the Sybil caveat in the residual.

### S-L2: Viewers and Operators read the approving Owner's full approval wallet
**CONFIRMED (EXP-G)**

**Where:** `policies.ts:52-56` and `:61-71` (`approvalWallet` and `approvedBy` are served under `account:read`).

**Failure scenario:** since round 2, the approval wallet is the workspace's pinned high-value signer, and every Viewer gets its full address (`EXP-G viewer sees approvalWallet: 0x2664… owner wallet: 0x2664…`). That makes targeting it easier, and it is inconsistent with M2's "others see a short identifier".

**Fix:** serve `approvalWallet` in full to Owners only, and short to everyone else.

### S-L3: the endorsement message doesn't say whose wallet is being endorsed
**PLAUSIBLE (social engineering)**

**Where:** `approval-wallets.ts:77` and `:84`. The beneficiary appears only as the opaque `urn:whiteflow:principal:pr_…`. The UI (`WorkspaceSettings.tsx`, ApprovalWalletsPanel) asks the requester to "send the message to its Owner and paste the signature".

**Failure scenario:** a hijacked Owner session asks a co-Owner to "endorse my new wallet" over chat. The endorser can't tell from the message that the wallet is the attacker's, because it names neither the member nor their email label.

**Fix:**
- Put the requester's display label (their masked email) in the statement, for example "for <label>, an Owner of …".
- Tell the endorser in the UI to confirm out of band (by voice or in person) that the wallet belongs to that person.

### S-L4: CON-11 has two narrow gaps
**Gap (a): the reads are not taken at one block. PLAUSIBLE.**
- **Where:** `capital.ts:189-203`, with `chainOffers` at `:75-81`.
- **What happens:**
  - `v1Obligations` reads `offerCount`, then `chainOffers` reads `offerCount` again, then `outstanding`, each a separate call to a load-balanced RPC (Ankr).
  - If the second `offerCount` is higher and crosses 200, the oldest offers are skipped silently.
  - A lagging node can also miss the newest funding.
- **Fix:** read everything at one `blockNumber` (viem `readContract({ blockNumber })`), and pass the first count into `chainOffers`.

**Gap (b): listed-but-unfunded invoice offers are not counted.**
- **What happens:** such an offer can be funded right after activation. Advances in the same state are counted (`advanceOf != 0`).
- **Fix:** count every invoice offer that is neither cancelled nor settled, matching the stricter advance rule, or have V2 routes re-check obligations at use time rather than trusting the activation snapshot.

## Informational
- **The first pin is trust on first use.** Before the first activation, any Owner, including a hijacked Owner login or an Owner the hijacker added, can win the pin. Concurrent first activations are serialized correctly (policy primary key, so 409, and the loser's pin rolls back). This matches the owner decision, but the warning is visible only in the approval step. Make it visible at workspace creation too, and have the pin notify (S-M1).
- **A workspace can be left with no Owner who holds an enrolled wallet.** If every Owner with an enrolled wallet is removed, nobody can approve or endorse, and support is needed. The UI disclosure mentions only the solo-Owner case. Warn in the remove and demote flows.
- **Batch 051 legacy backfill:** any workspace it creates with a policy but no `wf_approval_wallets` row is permanently locked. It fails closed, which is correct, but 051 must pin a wallet.

---

## Checked and sound (with evidence)

**H1, a takeover wallet:**
- A wallet newly linked via Privy is refused at approval issue (`policies.ts:154`). It is also refused at the one-statement re-check (`:207-209`), because the enrollment is bound to `(business, principal, wallet)`.
- The test "H1: the first activation pins…" covers this, and I re-traced it.

**H1, the first-pin window:**
- **It cannot be re-opened.** `wf_approval_wallets` and `wf_settlement_policies` are insert-only (grep finds no DELETE or UPDATE). The pin runs only at `cur = 0`, inside the activation statement.
- **The pin is not dropped silently.** `ON CONFLICT DO NOTHING` can't fire at `cur = 0`, because no endorser exists before the first pin, so no enrollment row can exist yet.
- **Stale first-pin approvals are unusable.** An approval challenge issued while the window was open dies once someone else pins. Two independent checks stop it: `proposedVersion = expected + 1` with `cur = expected`, and the enrollment clause.

**H1, enrollment:**
- The endorser must already be enrolled, and the wallet must not be. So self-endorsement with the same wallet is impossible.
- The challenge is keyed to `(nonce, 'enroll', business, requester)`, so another Owner can't confirm it.
- A wrong signer is refused before the statement, so nothing is consumed.
- Replays return the stored enrollment (`enrolledAnswer`).
- A concurrent duplicate either gets the winner's answer (via `wf_approval_wallets_pkey` 23505, or via a consumed challenge) or a 409.
- The endorser's Owner role is re-checked inside SQL_ENROLL under FOR SHARE. In READ COMMITTED, a concurrent demotion or removal re-evaluates the row (`role = 'owner'` fails), so nothing is enrolled. Harness E2 asserts exactly this, though I did not run it.
- A demoted or removed endorser can't endorse at all.

**SQL correctness under READ COMMITTED:**
- Parameter counts match: SQL_ENROLL $1..$10, SQL_ACTIVATE $1..$18, SQL_SIGN_IN $1..$12, all member forms $1..$11.
- The data-modifying CTEs communicate only through RETURNING (`pol`→`pin/n/a/idem`, `w`→`n/a`). None depends on seeing a sibling's table changes.
- The unreferenced `pin` CTE still runs, as data-modifying CTEs always do.
- `used` re-checks `consumed_at IS NULL` after waiting, so exactly one of N duplicates inserts.

**Lock order (no deadlock pair):**
- SQL_ENROLL takes only share locks on two membership rows (requester, then endorser) and never locks `wf_businesses`.
- Member changes take actor share, then the target row exclusively, then the business row. The business row comes last because `c` depends on `done`.
- Activation takes actor share and then its own challenge rows.
- A cycle would need a member change to hold the business row while waiting for a membership row, and that can't happen.
- The foreign-key KEY SHARE locks taken by inserts are compatible with the NO KEY UPDATE of `owner_count` and of the sign-in principal update.

**Notices that are written correctly** (delivery is S-M1):
- An enrollment notifies every Owner, the requester and the endorser included. The test asserts `[alice, bob]`.
- A wallet newly linked at sign-in notifies every Owner of each workspace where the linking person is an Owner, that person included, with a short address. `(xmax = 0)` correctly marks inserted rather than updated rows.

**M1/L3 idempotency:**
- The slot is `(business, principal, operation, key)`, all from the server-built context. A replay can't return another principal's or another workspace's answer.
- The stored-answer read happens after the scope check, so a demoted actor gets 403.
- The activation hash covers `{proofNonce, approvalNonce, expectedCurrentVersion}`, not the signatures, and that is safe:
  - the nonces are server-generated, single-use, and bound to their challenge rows and to the approving principal;
  - signatures only matter the first time;
  - a replay returns only the policy the same Owner created, which `GET /policy` already shows.
- The activation race path is correct: the loser's `used` matches zero rows, `pol` is empty, and a re-read returns the winner's answer. The member-op race path is not; see review-code C-M1.

**L2:**
- The approval is EIP-4361 with domain, URI, chain 1874, nonce and expiry. The resources bind the business, the policy hash and the proof nonce.
- `promptSafe` replaces `\p{Cc}\p{Cf}\p{Zl}\p{Zp}` in both messages and in the endorsement. The L2 test asserts U+2028, U+202E and U+200B never reach a prompt.

**L5:**
- **P-256 pin:** the key is pinned to `prime256v1`. The test checks that secp256k1 and P-384 keys are refused (`privyConfig` returns null).
- **`x-request-id`:** already validated (`auth-sessions.ts:23-26`).
- **Challenge pruning:** only *unconsumed* challenges more than 24 h past expiry are deleted. Policy rows reference only challenges consumed in the same statement as their insert, and the foreign key, which has no cascade, would block any delete anyway.
- **NFR-17 test:** checks logs, audit rows and notices against tokens, cookies, signatures and signed messages. `handle()` logs error names only.

**CON-11:**
- `advanceOf != 0` is checked first, with no offer read.
- Every read is type-checked and throws on failure (503, nothing consumed; tested). A book of more than 200 offers throws.
- The invoice rule matches `hasClaimsOn`'s invoice branch (`outstanding` = `totalSupply`). The advance rule is stricter than `hasClaimsOn`, which is the fail-closed direction.

**M2, partly sound:**
- Other members' email and linked wallets are withheld; the test covers this.
- Adds are limited to 10/min per Owner, and the limit refuses requests when the rate-limit store is down.
- No error message leaks SQL, secrets or another tenant's data.
