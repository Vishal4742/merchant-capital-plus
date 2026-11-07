VERDICT: CHANGES

# Batch 058, round 1: code review

Scope: `git diff d87d3ac..53a0187` limited to apps/mcp, packages/mcp, apps/web lib/components/app(connect, merchant/ai, merchant/page, api/mcp), db/051, apps/web/test. Main's own changes that came in with the merge are excluded. Read in full: journal.ts, journal-pg.ts, remote.ts, tools/context.ts, tools/operations.ts, apps/mcp/src/*, mcp-grants.ts, mcp-principal.ts, ai-connect.ts, ai-config.ts, components/ai/*, the merchant/ai pages, the consent and revoke routes, and the new tests. SDK 1.32.2 sources checked: bearerAuth.js (`expectedResource`, `req.auth`), token.js, authorize.js, register.js.

Re-run on Node 26.13.0 (CI's version): `packages/mcp npm test` gives 70 pass, 0 fail. `apps/mcp npm test` gives 22 pass, 0 fail. On Node 24 both fail at `node --test test/` (directory argument), so CI must stay on 26.

Not reviewed: uncommitted work currently in the worktree (`apps/mcp/vercel.json`, `scripts/build.mjs` now writing `api/index.mjs`, ci.yml, deploy.yml, `tools/vercel-deploy.sh`). DELIVERY §8/§9 still say `dist/index.mjs`. Review those when they are committed.

## HIGH (blocks)

### H1. A failed "done" settle after a successful create is recorded as "refused", and the retry creates a duplicate link
- **Where:** `packages/mcp/src/tools/context.ts:108-137` (settle at :124 and :117 sit inside the `try` whose `catch` settles "refused" at :135); `packages/mcp/src/journal-pg.ts:20-25` (JournalBusy message).
- **What:** `await base.journal.settle(scope, claim.key, "done")` runs inside the same `try` as `send()`. With PgJournal, settle is a network round trip to Neon plus up to 40 CAS attempts, so it can throw: a transient `fetch failed`, or `JournalBusy`. When it throws, the `catch` treats it as a definite refusal from WhiteFlow and calls `settle(..., "refused")`. If that second settle succeeds, the entry is no longer unresolved, so the next identical call (no key) finds no pending entry and no recent "done" entry. It mints a fresh key and the gateway creates a second link. If the error was `JournalBusy` (`expose = true`), the assistant is also told "nothing was created", which is false: the link exists. The settle at :117 (Mismatch path) has the same problem and turns needs_reconciliation into refused.
- **Reproduced:** I ran a scratch script outside the repo, using the real `makeContext` and the file `Journal` with settle("done") made to throw once. Output: `first call threw: neon: fetch failed` / `entry after first call: refused` / `keys sent: 2 distinct: 2`. The script has been deleted.
- **Why it matters:** this is the duplicate-write class that A5 ("write identity survives uncertain results") and B4 ("parallel creates with one key yield one link") exist to prevent. The remote journal makes it reachable in normal operation.
- **Fix:** only an error thrown by `send()` itself may lead to `settle("refused")`. Move the post-send settles out of that `try`, or wrap them separately: if settling "done" (or "needs_reconciliation") fails, log the error name, leave the entry pending (the next identical call resumes the same key, and the gateway replays the same record), and return the result. Alternatively, return a ToolRefusal with `outcome: "unknown"` and the key, never "refused". Make JournalBusy's "nothing was created" true only for `claim`: give settle its own error, or reword the message. Add a test: settle("done") throws once, then an identical retry sends the same key.
- **Owner:** builder, packages/mcp.

## FOLLOW-UP (MEDIUM / LOW, do not block)

### M1. Turning off the switch hides live grants and Disconnect, but does not stop them working (MEDIUM)
- **Where:** `apps/web/app/merchant/ai/page.tsx:88-91`.
- **What:** grants are listed only `if (config.available)`, which needs `WHITEFLOW_MCP_REMOTE=on`. apps/mcp, the gateway assertion check and the consent page don't read that flag. DELIVERY §10 rollback step "unset WHITEFLOW_MCP_REMOTE" therefore leaves every grant working, while the merchant sees "Service unavailable" with no list and no Disconnect.
- **Fix:** list grants and offer Disconnect whenever the database and `MCP_INTERNAL_SECRET` are present, independent of the prompt switch. Only the prompt and copy should depend on `available`.
- **Owner:** builder, apps/web.

### M2. With no PUBLIC_ORIGIN, setup stays "unavailable" even when the switch is on (MEDIUM)
- **Where:** `apps/web/lib/ai-config.ts:22`; `apps/web/app/connect/page.tsx:24-25`; `apps/web/app/merchant/ai/page.tsx:84`.
- **What:** every caller passes `currentAiConnect("")`. Without `PUBLIC_ORIGIN`, `setupUrl = parsePublicUrl("/connect")` is null, so `available` is false. DELIVERY §9.4 lists the web env as `MCP_INTERNAL_SECRET`, `WHITEFLOW_MCP_PUBLIC_URL` and `WHITEFLOW_MCP_REMOTE=on`, with no `PUBLIC_ORIGIN`. Rollout step 5 would silently show "isn't switched on". The `fallback` parameter is dead in practice.
- **Fix:** add `PUBLIC_ORIGIN` to §9.4, or pass the request origin (from `headers()`) as the fallback. Also call `currentAiConnect` once in `/connect` (it is called twice).
- **Owner:** builder, apps/web (and DELIVERY).

### M3. Refresh spends the token before checking resource and scope; a client retry then revokes the grant (MEDIUM)
- **Where:** `apps/mcp/src/provider.ts:125-138`.
- **What:** the UPDATE marks the refresh token used. Only afterwards does the code check `resource` (:136) and the widened `scopes` (:138). Suppose a client re-sends the scope it originally asked for, including `links:write`, which the consent screen leaves unticked by default. It gets `invalid_scope`, but its refresh token is now spent. If it retries with the same token, the reuse branch (:131) revokes the whole grant. The client is forced to re-consent every 10 minutes, or is disconnected.
- **Fix:** read the token, grant, resource and scope first, reject without spending, then spend with the atomic UPDATE. Or put the resource/scope conditions into the UPDATE's WHERE clause.
- **Owner:** builder, apps/mcp.

### M4. Consent screen shows only the client's self-declared name (MEDIUM, for security review)
- **Where:** `apps/web/app/merchant/ai/authorize/page.tsx:58,67,77`.
- **What:** `client_name` comes from open dynamic registration (`provider.ts:74`), so anyone can register "ChatGPT" with their own redirect URI and send a merchant the authorize link.
- **Fix:** show the redirect URI's host ("will return to claude.ai") next to the name.
- **Owner:** builder, apps/web.

### L1. An mcp_grant caller may create a link without an Idempotency-Key (LOW)
- **Where:** `apps/web/app/api/v1/links/route.ts:23`.
- **What:** only `via === "secret_key"` must send the header. The new `"mcp_grant"` caller goes through the non-idempotent `createLink`. The tool always sends a key, so this is defence in depth.
- **Fix:** `if (via !== "session")`.

### L2. Code exchange compares resource exactly, while authorize and refresh use sameUrl (LOW)
- **Where:** `apps/mcp/src/provider.ts:113-114`, compared with :85 and :136.
- **What:** authorize accepts `.../mcp/` (sameUrl), but the exchange compares `resource.href` with the stored `mcpUrl.href` exactly. A client that adds a trailing slash passes authorize and then fails the token exchange.
- **Fix:** normalise `resource` the same way before the UPDATE.

### L3. Net today uses the current relay fee and counts investors' share as kept (LOW)
- **Where:** `apps/web/lib/dashboard.ts:118-123`.
- **What:** the maths is right for this contract. Sales take the fee out of the price, and an invoice's recorded gross is amount + fee (MerchantPay.sol:156-158, :182-186), so gross − fee × count is correct for both. Two weaknesses:
  - (a) it uses the *current* `relayFee()`. A `setRelayFee` during the day misstates earlier payments. The `Paid` event carries each payment's fee.
  - (b) for a financed invoice, `toInvestors` is not kept by the merchant, though the doc comment says "what the merchant keeps". The tile's own text ("gross minus fees") is accurate.
- **Fix:** sum `fee` from the Paid logs when they are available, and reword the comment.

### L4. The same consent request can be approved more than once (LOW)
- **Where:** `apps/web/lib/server/mcp-grants.ts:105-134`.
- **What:** the request token has a `jti` that is never recorded. Within 10 minutes, Approve after a reload or a back-navigation creates extra live grants whose codes are never redeemed. They sit as "Authorized, awaiting verification" for 30 days.
- **Fix:** add a unique constraint on the `jti` (or on the code challenge) per consent.

### L5. A finished explicit key is blocked by an unrelated pending write (LOW)
- **Where:** `packages/mcp/src/journal.ts:101-112`.
- **What:** an explicit key whose own entry is settled (done/acknowledged) is refused when another identical write is pending under a different key. Re-sending the settled key would be a safe replay. The block is not permanent: it clears once that write resolves.
- **Fix:** none needed now. If changed, set `target` only when `!prior`.

### L6. Ponytail ladder (LOW)
- `apps/web/lib/ai-connect.ts:32-37,46`: `privateIpv4` is dead because `IPV4.test(host)` already refuses every IPv4 literal. Delete it.
- `apps/mcp/src/provider.ts:20`: duplicates `SCOPES` from `packages/mcp/src/remote.ts`, which app.ts already imports. Import it instead. The web copies (`GRANT_SCOPES`, ConnectGuide `SCOPES`, `MCP_TOOLS_FOR_EXAMPLES`) are justified by the build boundary and pinned by tests.
- `packages/mcp/src/journal-pg.ts:42`: `stored.filter((e) => e.scope === scope)` is redundant, because the document holds one scope.

### L7. Tests that pass for the wrong reason, or assert weakly (LOW)
- `packages/mcp/test/remote.test.ts:110`: `scope.replace(":", ":")` is a no-op.
- `remote.test.ts:156-160`: "the credential never appears" passes no `secrets` to `createRemoteServer`, so redaction is never exercised. The test passes only because no tool echoes the header. Pass `secrets: [token]` and make the fake gateway echo the Authorization header inside an error body.
- `apps/mcp/test/oauth-flow.test.ts:162-176`: the final "expired" assertion would also pass if the earlier wrong-redirect attempt had spent the code ("already used"). Assert the message, or that the grant is still live.
- No test covers H1 (a journal failure after a successful send).

## Checked and fine
- **decideClaim refactor.** Generated keys behave the same as before. Explicit keys now get the needs_reconciliation guard, the 23-hour age guard (flagged entry stored with the refusal), the guard against a different key while an identical write is unresolved, and MAX_UNRESOLVED. Nothing is blocked forever: `acknowledge` or `create_another` releases it.
- **PgJournal CAS.** It uses `UPDATE … WHERE version = $2`, so under READ COMMITTED a concurrent writer re-checks the WHERE and loses. INSERT … ON CONFLICT DO NOTHING covers the first row. BIGINT is read via `version::text`, and jsonb is accepted as object or string.
- **`material()`.** It skips only `last`-only changes. For unresolved entries `last` is unused. For done entries it only extends the replay and retention windows. A resume spreads `{...e}`, so jsonb key order is preserved and the comparison holds. Outcome changes and new entries always write.
- **remote.ts.**
  - Proxy: `registerTool` is called with the target as `this`. Dropped tools return undefined, and no tool module uses the return value.
  - Without an inputSchema the SDK passes only `extra`, and the wrapper uses `{}`.
  - `get_operation_status` scope is computed from the SDK-parsed args.
  - Events are awaited and their failures are swallowed.
- **apps/mcp app.ts.**
  - The 1.32.2 `requireBearerAuth` supports `expectedResource` and sets `req.auth`.
  - Middleware order is origin → bearer → `express.json` (no body parsing before auth).
  - Each request gets a fresh server and transport, closed on `res` close.
  - The listen guard is safe on Vercel.
  - The error classes come from the same SDK copy as the handlers.
- **mcp-principal path table.** It matches the six tools. `GET /api/v1/links` (list), sessions, and every non-GET except `POST /links` are closed. The grant row is re-read on every request.
