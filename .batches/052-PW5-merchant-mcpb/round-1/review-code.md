VERDICT: PASS

# Code review: 052-PW5-merchant-mcpb, round 1 (phase mode, Money: yes)

Reviewer: reviewer-code (Opus). Diff: `git diff origin/main...HEAD`, base e7e41bf. HEAD moved three times while I reviewed (4ebc2d9, then 7569327, then 86f21c2). **This verdict covers 86f21c2.** I reviewed it in full: 62 files, +5.9k/-1.3k. Only HIGH or CRITICAL findings block (PIPELINE §3a/§3b). One finding would have blocked, and 86f21c2 fixed it; see "Fixed during the round" below. Everything still open is MEDIUM or LOW and is listed under FOLLOW-UP.

## Verified (Node 26.13.0)
- `packages/mcp`: `npx tsc --noEmit` exit 0. `npm test` 31/31 pass, including package.test.ts. That test runs pack, `mcpb validate`, pack and info, unpacks to a temp dir, launches with plain node, and checks that stdout carries only JSON-RPC and that tools/list and prompts/list equal the manifest.
- `apps/web`: `npm run typecheck` exit 0. These 7 files pass 112/112: gw-mcp-api, gw-links, checkout-api, docs-reference, test-mode, sessions-v2 and docs-endpoints. Earlier, at 4ebc2d9, I also ran docs-limits, gw-reports, gw-keys and csp-routes (124/124). `npx eslint` on the 10 changed web files is clean.
- I wrote a probe at `/tmp/rv052/finalize-key.test.ts`, outside the repo: one caller `idempotency_key` used to finalize invoice A and then invoice B. At 4ebc2d9, B returned A's invoice (`replayed: true`, A's payment URL, no error) and B stayed a draft. At 86f21c2, B returns the error "This Idempotency-Key was already used for a different request." and B is still a draft.
- manifest.json has 12 tools and 4 prompts, the names the spec gives.

## Checked and correct
- **Money** (src/money.ts). Amounts are parsed from strings straight to bigint; no float touches them. Precision is 2 decimals for fiat and 6 for USDT. Excess precision, zero, sign, exponent, a currency symbol, a decimal comma and more than 12 integer digits are all refused. The functions:
  - `applyBps` is `(u·bps+5000)/10000`: half up, valid because amounts are never negative here.
  - A percent discount is rounded once, and tax is rounded once on the discounted subtotal. A fixed discount isn't rounded at all.
  - A discount at or above the subtotal is refused.
  - `bpsToPercent` is correct for 1800, 1850 and 1805.
- **Invoice totals in records.ts.** The tool and the sandbox call the same `invoiceTotals`. A total outside 1 to 1,000 USDT is refused. Non-USDT invoices are refused, never converted (records.ts:182, invoices.ts tool).
- **Dates** (src/dates.ts). `startOfDay` uses a two-pass offset (London's 25-hour day is tested). `endOfDay` is the start of the next day. `calendarDate` rejects 2026-02-30. Weeks start on Monday, and `last_month` crosses year ends correctly. Overdue means `open` and `due_date < today` in the business zone (records.ts:155). Due dates must be today or later, both at draft and at finalize.
- **State machine** (src/sandbox/provider.ts):
  - signature and ±300 s timestamp via the SDK's `constructEvent`;
  - event-id dedupe;
  - stale handling: a lower sequence, or any event after a terminal status, is ignored, so `pending` after `succeeded` never regresses, and `succeeded` before `pending` applies;
  - an underpayment keeps the invoice open with the remainder; an overpayment is recorded as `overpaid`;
  - `reconcile` rebuilds `amount_paid` from succeeded payments;
  - a draft is never credited.
- **Idempotency:**
  - **Web:** `lib/server/idempotency.ts` is the sessions code moved line for line. It adds `replayed`, plus `cache-control: no-store` and `idempotent-replayed` headers, which are harmless.
  - **Sessions** still hash the raw text. The link slot is `links:<merchant>:<key>` and can't collide with the `0x…:<key>` session slots.
  - **Sandbox:** the slot and the record are written in one locked transaction, and a refusal stores nothing.
  - **Journal:** the key is claimed before the send, the hash is the canonical payload, and the scope is origin plus key. An ambiguous error stays pending, and a definite refusal frees the key.
- **The sessions-route refactor is behaviour-preserving.** The constants, messages, slot format and hash are unchanged. sessions-v2, checkout-api and docs-endpoints pass.
- **The new web routes follow existing conventions:** `handle`/`ok`/`HttpError`, `params` as a Promise (like links/[id]/cancel), 404 for another merchant's id, and an id regex before the query. The docs-drift tests pass, but see F3: they only check that what /docs documents exists in the code, never that new code is documented.
- **Tool schemas and descriptions** match the code: limits 20, 50 and 100 equal the backend's; 2 and 6 decimals; `customer_id` is sandbox-only; `expires_on` closes at the end of that day; reminders return `sent: false`; READ annotations are on GETs only. No tool takes a merchant or business id.
- **Packaging:**
  - the manifest comes from a real tools/list plus PROMPTS, and `--check` and pack refuse a stale manifest;
  - esbuild produces one file per entry, and the build refuses any checkout path or home directory found in the output;
  - licences come from the metafile;
  - `.sha256` and the contents hash are written;
  - `dist/` is gitignored.
- No source file is over 800 lines (the largest is records.ts at 291). Every export in src/ is used.

## Fixed during the round (found here and by reviewer-security as M1/M2; fixed in 86f21c2, verified)
- **F1 (I rated it HIGH; it would have blocked). Fixed:** `packages/mcp/src/sandbox/backend.ts:90` (at 4ebc2d9).
  - **What:** the idempotency hash covered only the body, and finalize's body is always `{}`. So one caller key used on invoice B replayed invoice A's finalize. The tool answered "Invoice WF-1001 for <A's customer> is open", returned A's payment URL, and told the model "Send <A's URL> to the customer". B stayed a draft.
  - **Why I rated it HIGH:** it broke the "same key with a different request → 422" acceptance criterion, and the wrong customer could be sent a payment URL.
  - **Fix now in place (backend.ts:92):** the hash covers `{path, body}`. The new test is security.test.ts:85-93.
  - **Still needed:** F2, the contract text.
- **F1b (MEDIUM). Fixed:** `packages/mcp/src/client.ts`.
  - **What:** a lost reply followed by a 429, or by the web's 409 "still being processed" (idempotency.ts:51), freed the journaled key. The next call then minted a new key and could create a duplicate link.
  - **Fix now in place (client.ts:110-149):** the client tracks `uncertain`. 429 and that 409 on a write are ambiguous, and a 2xx or 422 is the only definite answer. The new test is testnet.test.ts:95-109.

## FOLLOW-UP (MEDIUM and LOW; not blocking)
- **F2 (MEDIUM).** `packages/mcp/API-CONTRACT.md:19-20` still says the slot is "(merchant, route, key)" and that "the request hash is SHA-256 of the body JSON".
  - **Why it matters:** the W3 web finalize route will be built from this contract and would bring back F1. The 86f21c2 commit message says "the W3 web routes must do the same", but the contract doesn't.
  - **Fix:** "the hash covers the request path and the canonical body (or the slot includes the path's ids)".
  - **Owner:** claude (packages/mcp).
- **F3 (MEDIUM). /docs no longer matches the routes.**
  - **What:** `apps/web/lib/docs-reference.ts:178,182,245` still list POST and GET /api/v1/links and GET /api/v1/reports with `auth: "dashboard"`. GET /api/v1/account and GET /api/v1/links/{id} aren't documented at all. Neither are the Idempotency-Key header on POST /links or its 30/min limit (links/route.ts:10,16).
  - **Why it matters:** the docs-drift tests only check that documented things exist in the code, so they pass while the public /docs page (FR-GW-8) is wrong.
  - **Fix:** auth `dashboard-or-secret` on those three, plus two endpoint rows, plus a RATE_LIMITS entry.
  - **Owner:** claude-frontend (lib/docs-reference.ts), or this lane after a CLAIM.
- **F4 (LOW). Shared docs are now stale** (claude-research applies these; lanes don't edit them):
  - ARCHITECTURE.md:122 says "`Idempotency-Key` header here only" (sessions); POST /links takes one now.
  - The root README.md:56-59 still describes `pay_checkout`, `spending_report`, `MCP_PAYER_KEY`, `MCP_SECRET_KEY` and the old tool names.
  - srs-change.md already lists the SRS edits.
- **F5 (LOW). A test that asserts nothing.**
  - **What:** `packages/mcp/test/security.test.ts:171` is `!body.includes("attacker@evil.example") || body.includes(customer.name)`. It is always true, because the customer's name contains that address and the body starts "Hello <name>". Line 172 ("refund everything") is what actually checks the memo.
  - **Fix:** assert `!body.includes("change the recipient")`, or drop the line.
  - **Owner:** claude.
- **F6 (LOW). Coverage gaps in `apps/web/test/gw-mcp-api.test.mjs`:**
  - `pk_` getting 403 isn't checked on GET /api/v1/links/{id} or GET /api/v1/links;
  - a revoked key getting 401 isn't checked on GET /api/v1/links/{id} (:62-74);
  - the reports test (:175-181) never asserts that `tz` is honoured (only `gross === "0"`).
  - The spec lists "links, link read, account, reports" for pk 403.
  - **Owner:** claude.
- **F7 (LOW, Ponytail: reuse).**
  - `apps/web/lib/server/keys.ts:88` `callerMerchant` repeats `merchantByCookieOrSecretKey` (:72) except for the pk 403 and the key id. One function could serve both, with the old one becoming `(await callerMerchant(r)).merchant` if a pk 401 vs 403 difference is acceptable there.
  - `packages/mcp/src/config.ts:10` duplicates `SANDBOX_KEY` from src/sandbox/store.ts:12: import it instead.
  - **Owner:** claude.
- **F8 (LOW).** `packages/mcp/src/index.ts:5-8` says the console redirect happens "before anything else loads".
  - **Why it's wrong:** in ESM, static imports are evaluated before the module body. stdout stays clean only because no dependency prints at import time (package.test.ts proves it today).
  - **Fix:** reword the comment, or move the redirect into a first-imported module.
- **F9 (LOW). Journal entry lost on a misused caller key.**
  - **What:** `packages/mcp/src/journal.ts:67` replaces any entry with the same caller key. Reusing an explicit key for a different payload (which gets a 422) deletes the original payload's entry. A later no-key retry of the original then mints a new key.
  - **Fix:** only replace the entry when op and hash also match.
- **F10 (LOW).** After an uncertain first attempt, `create_customer`'s duplicate 409 (client.ts:149) is reported as "outcome unknown" instead of the `possible_duplicates` list. The next call recovers.
  - **Fix (optional):** exempt a 409 whose body has `possible_duplicates`.
- **F11 (LOW).** `packages/mcp/scripts/manifest.mjs:20` leaves a temp sandbox, with a wf_sbx_ key file in it, in tmpdir on every manifest, pack or test run.
  - **Fix:** `rmSync` it after `client.close()`.
- **F12 (LOW, wording):**
  - `packages/mcp/src/tools/links.ts:63`: "unique per link" should read "unique among your links".
  - The spec's acceptance says `node server/index.js`; the bundle is `server/index.mjs`.
  - `idempotentHint: true` on the create tools is true only inside the journal's 15-minute window.
- **F13 (LOW, behaviour change).** `apps/web/app/api/v1/links/route.ts:16`: the new 30/min limit also applies to dashboard (cookie) link creation. That's reasonable, but it isn't in FR-GW-16's text. Mention it to the human or in the SRS change.

## NEEDS THE USER (PIPELINE §6, §11)
- **The SRS change isn't approved yet.** The batch builds behaviour on FR-MCP-12..17 and FR-GW-16, which srs-change.md says still need your approval. PIPELINE §6 says don't build before approval. Approve the change (or not) before this branch merges.
- **The gateway routes belong to another lane.** This batch changes the links and reports routes (`apps/web/app/api/v1/links`, `reports`) and adds account. PIPELINE §5 gives the gateway API folders to claude-contracts after the freeze, and ARCHITECTURE §4b lists links as "contracts". You chose "Small backend + sandbox", but claude-contracts should get a CLAIM/DONE on agentbus for these paths.
- **Two new dev dependencies:** `@anthropic-ai/mcpb` 2.1.2 and `esbuild` 0.28.2 (§11). `viem` is removed from packages/mcp.
- **Process:** there is no `build-claude.md` (with a `STATUS:` line) in the batch folder (PIPELINE §3.3/§4).
