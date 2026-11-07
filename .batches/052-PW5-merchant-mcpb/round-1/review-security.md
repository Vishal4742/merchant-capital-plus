VERDICT: PASS

# Security review: 052-PW5-merchant-mcpb, round 1 (phase mode, Money: yes)

Reviewer: reviewer-security (Opus). Diff: `git diff origin/main...HEAD` (base e7e41bf, head 7181c23), 60 files.
Fast/phase rules: only HIGH or CRITICAL blocks. **No CRITICAL or HIGH finding.** Two MEDIUM and six LOW are under FOLLOW-UP.

## What I checked, with the result

Web (apps/web):
- **Auth and tenancy.** `callerMerchant` (lib/server/keys.ts:88-98) tries the session first and falls back to the key only on a 401. With no credential it returns 401, a pk_ key gets 403, and a revoked or unknown key gets 401 (`authenticateKey` filters on `revoked_at IS NULL`). Every changed route takes the merchant from the credential only. `linkById` filters `id AND merchant` (links.ts:231-233). `linkPayments` filters `c.merchant = link.merchant`, and both sides are lowercase (checkouts.ts:41). Another merchant's link id returns 404. The account route returns `key_id` only, never key material.
- **Idempotency slots.** A links slot is `links:<merchant lc>:<key>` (links/route.ts:31). A sessions slot is `<merchant lc>:<key>` (sessions/route.ts:41) and always starts with `0x`. The two namespaces can't collide, and neither can two merchants. Another merchant's stored reply can't be replayed. The slot column is TEXT (db/050_web_sessions.sql:39), so a 255-character key fits.
- **The helper is unchanged for sessions.** idempotency.ts:41-71 matches the deleted code line for line. Sessions still hash the raw text (sessions/route.ts:41). There are only two additions: `replayed: true` on a stored reply, and two response headers from `send` at :73 (`cache-control: no-store` and `idempotent-replayed`). Both are harmless.
- **Canonical hash on links.** `requestHash` and `createLink` read the same `JSON.parse` output, so two bodies that hash equal are the same request to createLink. Duplicate JSON keys don't break this, because both sides keep the last value.
- **Refused creates free the key.** An HttpError inside `create` becomes a non-201 reply, and `first()` then deletes its own row. Other errors also delete the row and then reach `handle()`. The rate limit (30/min per merchant, links/route.ts:16) runs after auth and before the body is read.

MCP (packages/mcp):
- **Nothing can mark a payment paid or move money.** No tool imports `sandbox/provider.ts`; only `sandbox/cli.ts:12` does. The sandbox fetch has exactly four write routes: customers, links, invoices and finalize (sandbox/backend.ts:119-157). None of them reaches `processEvent`. pay_checkout and viem are gone. `MCP_PAYER_KEY` is only warned about, and its value is never read (config.ts:36). On testnet the client can only reach fixed paths. Every id is regex-checked before `encodeURIComponent`: `LINK_ID` (tools/links.ts:13) and `REF` (tools/invoices.ts:13). No dot-segments or slashes get through, so `/invoices/[id]/pay` can't be reached.
- **The key is not re-sent elsewhere.** The client uses `redirect: "error"` (client.ts:105), and retries go only to the same URL. `gatewayOrigin` allows https only, or http for localhost, with no userinfo, query or path (client.ts:43-50). Retries reuse the same Idempotency-Key, and a write without one throws (client.ts:101-103).
- **Secret leakage.** Every tool result and error goes through `redactor([apiKey])` (safety.ts:35-79). stderr uses the same redaction. Stacks are never shown to the model, and only "exposed" messages pass. The sandbox webhook secret lives only in sandbox.json, and no route or tool returns it. The test "no secret leaves the server" passes.
- **Prompt injection.** Stored text goes through `untrusted()`, which removes C0/C1 controls, zero-width and bidi characters and caps the length. It comes back only in data fields, with `DATA_NOTICE` attached. The reminder recipient comes from the customer record, not from the memo, and the memo is not in the reminder body (sandbox/records.ts:238-262). No tool takes a merchant or business id; the test at security.test.ts:40-44 checks this.
- **Webhook verification (sandbox provider).** It uses the SDK's `constructEvent`: HMAC-SHA256 with `timingSafeEqual` and a ±300 s window in both directions (sdk/index.ts:106-123). Event ids are deduped over the last 10,000; the 5-minute window covers anything older. A status never goes backwards: `prior.status !== "pending"` or a lower sequence is stale (provider.ts:70-73). An event whose payment, merchant, target or amount disagrees with the recorded payment is rejected. Underpayment keeps the invoice open, and overpayment is reported. `reconcile` rebuilds the paid totals from succeeded payments.
- **Journal.** Entries are scoped by `sha256(origin|apiKey)`, cut to 96 bits (journal.ts:50), so one merchant's or backend's entry is never reused for another. A key is reused only when op and canonical payload hash match, within 15 minutes, and the entry wasn't refused. The scope hash on disk doesn't help anyone guess a 192-bit key.
- **MCPB manifest.** `api_key` is `sensitive: true` and not required (manifest.json:141-148). An empty field arrives as `""` or as the `${user_config.x}` placeholder, and both are treated as not set (config.ts:22-25). A pk_ key or a malformed key stops startup, and the error never repeats the key.
- **Bundle.** `dist/` is gitignored and not tracked. The rebuilt bundle (`dist/bundle/server/index.mjs`, `sandbox-cli.mjs`) contains 0 matches for `sk_test_…{32}`, `pk_test_…{32}`, `wf_sbx_…{32}`, `0x…{64}` or `PRIVATE_KEY`. build.mjs refuses output that contains the checkout path or the home directory.

## Required grep (`(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})` over the diff's files, .env* excluded)
- packages/mcp/src/config.ts:37: the env-var *name* `MCP_SECRET_KEY` inside a warning string. No value.
- packages/mcp/test/units.test.ts:83-84: the fixture `"sk_test_SECRETSECRET"`, which is not key-shaped (a real key has 32 characters after the prefix).
- packages/mcp/package-lock.json: 0 hits. No 64-hex string anywhere in the diff.
None of these is a real secret.

## Tests run (Node 26.13.0)
- `packages/mcp && npm test`: **30/30 pass**, including the packaged-archive launch, tenancy, credentials, idempotency, provider events, injection and no-secret tests.
- `apps/web && node --experimental-test-module-mocks --test test/gw-mcp-api.test.mjs`: **9/9 pass**.
- Two read-only probes, run in a temp dir outside the repo, confirmed M1 and M2 below.

## FOLLOW-UP (not blocking)

### M1 (MEDIUM): after a lost reply, a 429 or 409 on the retry frees the journaled key, so the next call can create a duplicate (FR-MCP-15 gap)
- **Where:** packages/mcp/src/client.ts:120 (only 5xx and 429 are retried), :147-148 (429 → `ambiguous: false`), :153-154 (409 → not ambiguous); packages/mcp/src/tools/context.ts:64-68 (any ApiError that isn't ambiguous → `settle(key, "refused")`).
- **How it happens:** Attempt 0 of `create_payment_link` reaches the gateway, which creates the link, but the reply is lost (a socket error or the 15 s timeout). The client's retry then gets either 429 (the links route rate-limits before the idempotency slot, links/route.ts:16) or 409 `STILL_CREATING` (the first request is still running after the 10 s wait). The final error isn't ambiguous, so the journal marks the key "refused". The model is told to "retry with the same idempotency_key", but the result never shows that key. It calls again without one, gets a new `wfmcp_…` key, and the gateway creates a **second link**. The same holds for drafts and customers.
- **Probe output:** 429 case: keys `["wfmcp_21d73c0d" ×3, "wfmcp_b093f51a"]`. 409 case: `["wfmcp_522afab0" ×2, "wfmcp_a9bf765f"]`. In both, the same key was not reused on the retry call.
- **Impact:** a duplicate active payment link or draft. Nothing moves and nothing is sent. The merchant could share the wrong one.
- **Fix:** in `#call`, remember whether any earlier attempt of a write was ambiguous (a network error, a timeout or a 5xx). If one was, make the final ApiError ambiguous unless the final status is definitive for that key (2xx or 422). Treat a 409 on a write whose body is the in-progress message as ambiguous. On 429, return the `idempotency_key` in the refusal details, since the message already tells the model to reuse it. Add a testnet test for "lost reply then 429" and "lost reply then 409".
- **Owner:** claude (packages/mcp).

### M2 (MEDIUM): sandbox finalize idempotency ignores which invoice; the same key on invoice B replays invoice A's finalize
- **Where:** packages/mcp/src/sandbox/backend.ts:90 (the hash is only the body, which is always `{}` for finalize), :95 (slot = merchant + route name `finalize` + key), :146-155.
- **How it happens:** the model passes the same explicit `idempotency_key` to `finalize_invoice` for invoice A and then invoice B. The sandbox replays A's record with `idempotent-replayed: true`. B stays a draft. The tool reports "Invoice WF-1001 … is open" and A's payment URL in answer to a request about B.
- **Probe output:** `finalize B (same key): 200 replayed=true returned invoice inv_OyW7… B is inv_6n8v…` and `B status after: draft`.
- **Impact:** within one merchant only, and sandbox only. It is listed because the sandbox is the W3 lane's executable reference for the contract: a web finalize built from it would inherit the same hole. The spec says the same key with a different request must fail with 422.
- **Fix:** hash `${url.pathname}\n${canonical(input)}`, or put the path params into the slot's route. Add a test: the same key on two different invoices → 422.
- **Owner:** claude (packages/mcp). Also tell the W3 lane to hash the path for any route whose target is in the URL.

### L1 (LOW): the lock-file stale break is check-then-act, and release doesn't check ownership
- **Where:** packages/mcp/src/state.ts:20-33.
- **Problem:** once a lock is older than 30 s, two processes can both run `statSync` and `rmSync`, then both create the lock and both write. The whole-file rewrite then loses one update. `release()` deletes whatever lock file is there, which may belong to another process. This needs a lock left behind by a killed process, and it affects only the sandbox and the journal.
- **Fix:** write a random token into the lock file and delete it only if the token still matches. Break a stale lock by renaming it to a unique name and then retrying `wx`.

### L2 (LOW): file modes are set only when files are created
- **Where:** packages/mcp/src/state.ts:47-48 (the temp file is `${file}.${pid}.tmp`, a predictable name, and `writeFileSync` follows a symlink there); `mkdirSync({mode: 0o700})` applies only to a new directory; packages/mcp/src/sandbox/store.ts:182 (rewriting the credentials file keeps the existing file's mode).
- **Problem:** this matters only if `WHITEFLOW_STATE_DIR` points at a directory other local users can write to. The default %APPDATA% or ~/.config location is fine.
- **Fix:** open the temp file with `wx` and a random suffix, and on POSIX `chmod` the directory (0700) and files (0600) at startup.

### L3 (LOW): a damaged sandbox-credentials.json can print part of the sandbox key to stderr
- **Where:** packages/mcp/src/sandbox/store.ts:178 runs a bare `JSON.parse`, and packages/mcp/src/index.ts:14 prints `error.message` without the redactor (which doesn't exist yet at that point).
- **Problem:** Node 26's SyntaxError quotes up to about 10 characters of the input. I confirmed `Unexpected token 'w', "wf_sbx_ABC"... is not valid JSON`. Only a fragment of a sandbox-only key leaks.
- **Fix:** catch the error and throw a `StateError` without the parser's message, as `state.ts` `read()` already does.

### L4 (LOW): the sandbox `/api/v1/reports` accepts any range and any tz
- **Where:** packages/mcp/src/sandbox/backend.ts:224-227 and packages/mcp/src/sandbox/records.ts:289.
- **Problem:** the report loops one day at a time with no 92-day cap. An invalid `tz` throws a RangeError that the sandbox doesn't catch, and the client then retries it as a network failure. The tool bounds the range itself (dates.ts `resolveRange`), so this is only a local DoS and a mismatch with the contract.
- **Fix:** check `validZone(tz)` and `MAX_RANGE_DAYS` in the sandbox route, as the web's `rangeOf` does.

### L5 (LOW): backend error text reaches the model without `untrusted()`
- **Where:** packages/mcp/src/client.ts:139.
- **Problem:** `said` is trimmed to 300 characters and has the key removed, but control and bidi characters are not stripped. The text comes from the backend.
- **Fix:** pass it through `untrusted(said, 300)`.

### L6 (LOW, sandbox correctness): a rejected event id still counts as processed
- **Where:** packages/mcp/src/sandbox/provider.ts:62-64.
- **Problem:** the event id joins `processed_events` before the target lookup. An event rejected with "unknown merchant or target" is therefore logged as a duplicate when redelivered, and is never applied.
- **Fix:** add the id to `processed_events` only on the applied or stale paths.

## NEEDS THE USER
- batch.md records a Privy app secret found in another lane's uncommitted `.batches/050-P5-privy-onboarding/batch.md` (P:/Whiteflow). It was redacted, but **the human still has to rotate it** (AGENTS.md: the owner lane rotates it and claude-research is told).
- New dev dependencies (PIPELINE §11): esbuild 0.28.2 and @anthropic-ai/mcpb 2.1.2. Both are dev-only, and the .mcpb ships a single esbuild bundle with no node_modules.
- The SRS change (FR-MCP-12..17, FR-GW-16) is pending the human's approval. sk_test_ keys remain unscoped, full-merchant credentials that now also reach links and reports. The spec lists scoped and expiring keys as a production prerequisite.
