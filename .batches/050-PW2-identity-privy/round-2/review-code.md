VERDICT: PASS

# Batch 050 round 2: independent code review (PR #44, `wf/stage3-identity`, d8a99ef..542487e)

**Reviewer:** an independent subagent, review only (no product edits), 2026-11-07.

**Verification I ran (Node 26.13.0, from `apps/web`):**
- `node --experimental-test-module-mocks --test test/identity-flow.test.mjs test/identity-privy-token.test.mjs test/capital-obligations.test.mjs` passes **33/33**.
- `npx next typegen && npx tsc --noEmit --incremental false` exits **0**.
- `npx eslint components/workspace lib/server/{approval-wallets,policies,businesses,auth-sessions,capital,privy-token}.ts app/api/v2 test/{identity-flow,capital-obligations,identity-privy-token}.test.mjs` exits **0** with no output.
- Throwaway PGlite experiments outside the repo, now deleted, quoted as EXP-x.
- Neon harness: not run (no remote database allowed).

**Verdict:** no critical or high *code* finding, so this file passes. **The batch is still blocked by review-security.md S-H1** (dormant enrollments revive on re-add). That is a logic gap in the H1 implementation too, and is counted there to avoid double-counting.

---

## Medium

### C-M1: the M1 race path is wrong for two of the three member operations
**CONFIRMED (EXP-B, EXP-C)**

**Where:**
- `apps/web/lib/server/businesses.ts:231-233`: addMember maps `wf_memberships_pkey` 23505 straight to 409.
- `:298`: removeMember maps `done = 0` straight to 404.
- `:96-110`: withIdempotency only reads the stored answer back on `wf_idempotency_pkey`.

**Failure scenario:**
- Two identical requests (same key) race, both pass the read-before-write, and one write wins. For add, the loser's membership INSERT hits the membership primary key *before* the idempotency INSERT (`done` runs before `i`), so it answers `409 "already in this workspace"`. For remove, the loser's DELETE finds nothing, `i` inserts nothing (it reads `FROM done`), and it answers `404`.
- Reproduced with `Promise.all`: PGlite interleaves at each await, so both reads happen before either write.
  - EXP-B: `['201 {...}', '409 {"error":"That person is already in this workspace."}']`
  - EXP-C: `['200 {...}', '404 {"error":"Not found."}']`
- A client retry after a timeout is the textbook case. The response says "the plain INSERT still settles races", which is true for role changes and activation but not for add and remove.

**Fix:**
- In both branches, call `storedAnswer(slot)` first and return it on a hash match.
- Add a `Promise.all` duplicate test for add and for remove.

### C-M2: the tests would pass a broken implementation in three places
**CONFIRMED (traced)**

**(a) SQL_ENROLL's endorser re-check is never exercised in CI.**
- **Where:** `test/identity-flow.test.mjs:442-462`.
- **What happens:**
  - In that test, alice is both the requester and the endorser's Owner.
  - After her demotion, the confirm returns 403 from `ownerCtx` (`approval-wallets.ts:138`, `requireScope(policy:activate)`) before any SQL runs.
  - Deleting `AND EXISTS (SELECT 1 FROM endorser)` from `approval-wallets.ts:108` would still pass CI. Only the Neon harness E2 covers it, and the harness is not in CI.
- **Fix:** add a PGlite case where bob (an Owner) requests and alice's enrolled wallet signs, then bob demotes alice before confirming. Expect 403 and nothing enrolled.

**(b) SQL_ACTIVATE's enrollment clause (`policies.ts:207-209`) is never reached.**
- **What happens:** the takeover test is refused earlier, at approval issue (`:154`).
- **Fix:** insert an `approval` challenge for an unenrolled linked wallet directly in the test database, then activate. Expect 409 with nothing consumed.

**(c) There is no concurrent-duplicate test for member operations.** C-M1 slipped through because of this.

## Low

### C-L1: addMember's replay depends on a lookup that runs before the stored-answer read
**CONFIRMED (EXP-F)**

**Where:** `businesses.ts:215-220`. The rate limit and the target lookup run first, and the hash is over the *resolved* principal.

**Failure scenario:**
- The Owner adds bob by wallet W (201). Bob signs in again without W, so W leaves `wf_principal_wallets`. The same request replayed now answers `404 "Nobody has signed in…"` (EXP-F).
- Replays also spend the 10/min budget, so the 11th replay gets 429 instead of the stored 201.

**Fix:** hash the normalized input (`{op:"add", wallet|email, role}`), and call `storedAnswer` before the rate limit and the lookup.

### C-L2: derived state was fixed for the approver but not in ApprovalWalletsPanel
**CONFIRMED (traced)**

**Where:** `components/workspace/WorkspaceSettings.tsx:412-413`. `useState(candidates[0])` is seeded from props once.

**Failure scenario:**
- After an enrollment, `onEnrolled` reloads `pinned`. The panel is not remounted, so `wallet` still holds the wallet just enrolled.
- With two or more unenrolled linked wallets, the select shows no matching option, and the next "Ask for an endorsement" sends the enrolled wallet, which answers 409.

**Fix:** derive it the same way as `chosenApprover`: `const chosen = candidates.includes(wallet) ? wallet : (candidates[0] ?? "")`.

### C-L3: the approval-wallet list includes wallets of people who are no longer Owners
**CONFIRMED (EXP-A list output)**

**Where:** `approval-wallets.ts:41-42` (no join to memberships), and `WorkspaceSettings.tsx:454` and `:470-471`.

**Failure scenario:**
- A removed member's wallet is still listed, and the UI labels it "another Owner's".
- It is offered as an endorser, and choosing it answers 403.

**Fix:** join `wf_memberships` and return an `owner` flag (or revocation state, per S-H1). Label those rows accordingly, and leave them out of the endorser options.

### C-L4: `isDbDown` treats Postgres 08P01 (protocol violation) as an outage
**CONFIRMED (traced)**

**Where:** `apps/web/lib/server/v2.ts:14`, `/^(08...|53...|57P0[123])$/`.

**Failure scenario:** a bind-parameter mismatch (a code bug, like the promote `$11` bug) answers `503 "can't reach its database"`. That masked the promote bug, which the response itself notes, and it will mask the next one.

**Fix:** match only the connection-exception codes (`08000|08001|08003|08004|08006|08007`), so 08P01 surfaces as a 500 with its name logged.

### C-L5: the in-place edit of migration 053 doesn't reach a database that already applied round-1 053
**CONFIRMED (traced)**

**Where:** `db/053_identity.sql:75`, the purpose CHECK inside `CREATE TABLE IF NOT EXISTS`. `db/migrate.mjs` re-runs every file and doesn't track which were applied.

**Failure scenario:** on any database where the round-1 `wf_challenges` exists and was not rebuilt (a preview branch or a local database), every `'enroll'` insert fails with 23514, which surfaces as a 500. The harness drops and rebuilds its wf tables, and 053 is unmerged, so this is acceptable.

**Fix:** either state "rebuild any database that applied round-1 053" in the gate, or add the re-run-safe pair `ALTER TABLE wf_challenges DROP CONSTRAINT IF EXISTS wf_challenges_purpose_check;` and `ALTER TABLE wf_challenges ADD CONSTRAINT wf_challenges_purpose_check CHECK (purpose IN ('receiving','approval','enroll'));`. Both are splitter-compatible.

### C-L6: confirmEnrollment gives a misleading answer when the wallet was unlinked between request and confirm
**Where:** `approval-wallets.ts:179-181`.

**What happens:** if the requester unlinked the wallet in Privy and signed in again, SQL_ENROLL's `c` matches nothing, and the answer is `409 "expired or was already used"`.

**Fix:** report "that wallet is no longer linked to your sign-in" when `wf_principal_wallets` lacks it.

### C-L7: the settings-page SIWE item is deferred in a circle
**CONFIRMED (git)**

**What happens:**
- `round-2/response.md` says the settings page "belongs in batch 051 … listed in 051 GATE.md".
- 051's `GATE.md` (9c979c7, line 49) says "Batch 050 round 2 (now led by ef) includes it".
- Neither batch owns it. The 051 review's condition is technically met, because 051 lists it as a known issue.

**Fix:** name one owner and one batch, and record it in HANDOFF.

## Informational
- **The `(xmax = 0) AS fresh` trick** (`auth-sessions.ts:59`) relies on Postgres internals. It is widely used, and it works on PG 9.5+ and PGlite, as the H1 linked-wallet test shows. Keep the test.
- **An unreachable branch:** the `wf_idempotency_pkey` 23505 branch in `activatePolicy` (`policies.ts:270`) can't fire. Two same-key activations can't both insert a policy, so the idempotency insert never conflicts. It is harmless.

---

## Checked and sound
- **Promote fix (`setMemberRole`, `$11`):**
  - Every form now references $1..$11, matching the 11 parameters passed.
  - The promote form's `SET role = $11` gets its type from the column.
  - The "H1: an endorser must be…" test promotes bob to Owner (200), which would have been 08P01 before.
- **The test-15 handle fix:** `pg = await setupDb()` in `finally` gives later tests the live database.
- **Test 15's coverage:** it covers all 16 exported v2 handlers (14 in the list, plus sign-in and `/me`). Each fails at the session lookup, which matches its title for a full outage. The no-op `replace("", "")` assertion is gone.
- **M1, sequential replays:**
  - `storedAnswer` reads before the write.
  - The M1 test asserts that add, role and remove replays return the original status and body, and that the same key with another payload is 409.
  - Without the read first, add and remove would answer 409 and 404, so the test is not vacuous. The role replay alone would pass without the read, but add and remove guard it.
- **L3:** `idempotencyKey` is required (400 without it). The UI sends `activate:<approvalNonce>`, one key per signed pair, valid under `IDEM_KEY`. The response is stored as `to_jsonb(pol)` and replayed through `toPolicy` (the test asserts deepEqual 201).
- **CON-11 tests:** the five capital-obligations tests cover: an advance with an unreadable book, no obligations, the invoice filters (sold out, cancelled, settled, someone else's), failed or odd reads throwing, and a book of more than 200 offers throwing. The obligations read is injected (`{ read }`), so the tests are hermetic.
- **The P-256 test** generates real secp256k1 and P-384 keys.
- **The NFR-17 test:** it captures `console.*` around a failed sign-in, a wrong approval, a good activation and an enrollment. It then greps the logs, the audit rows and the notices for every token, cookie, signature and signed message.
- **UI:**
  - `chosenApprover` is derived (no effect syncing).
  - `load` depends on `[owner]`.
  - The approver list is limited to your enrolled wallets, or to all of them while the first pin is open, with the first-pin disclosure shown.
  - A sign-out failure is shown with `role="alert"` and the page doesn't navigate.
  - Other members show `label` only, and the role `<label>` uses `m.label` (M2).
- **File sizes:** WorkspaceSettings.tsx 633, identity-flow.test.mjs 499, businesses.ts 301, policies.ts 283, approval-wallets.ts 182. All are under 800.
- **Dead code:** none found beyond the unreachable branch noted above. tsc and eslint are clean.
- **Migration 053:**
  - Still re-run safe: every statement is `IF NOT EXISTS`, and the new table and index are additive.
  - Splitter-compatible: comments are stripped first, and no statement contains a line-ending `;` before its end.
  - PGlite applies it through `sqlStatements`, and the harness applies all migrations twice.
  - `wf_approval_wallets` has foreign keys to businesses and principals, with no cascade. Its primary key `(business_id, wallet)` gives the `wf_approval_wallets_pkey` name the code matches.
- **`tools/stage3`:** `urlFor` no longer prints a malformed URL. The child adds `enroll`. E1 holds the requester's membership and asserts 200×3 with one enrollment and one audit row. E2 stages the endorser's demotion before the confirm (business row held) and asserts 403, nothing enrolled and the challenge unused. The harness SQL in E1 and E2 is correct as written; I did not run it.
