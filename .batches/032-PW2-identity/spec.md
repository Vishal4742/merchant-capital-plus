# Spec: 032-PW2-identity — Stage 3 / W2: business identity and receiving policies (ACTIVE, frozen 2026-11-06)
Corrections A–E applied; non-author review round 1 (5 high/8 med/6 low) and round 2 (1 high/4 med/3 low) all resolved below — the reviewer stated it would call the spec ready once the round-2 items landed (they have). Stage 2 closed 2026-11-06. FROZEN at batch 032 start.
Activated 2026-11-06 after batch 031 closed at its human gate (owner authorized Stage 3 once its prerequisites passed).

## Requirements (docs/SRS.md v3.0 §8)
FR-BIZ-1, FR-BIZ-2, FR-BIZ-3, FR-BIZ-4, FR-BIZ-5 (activation + V1-obligation refusal for V2 only), FR-BIZ-6 (interim: wallet SIWE, revocable sessions, recovery limit disclosed), FR-AUTH-1, FR-AUTH-2, FR-AUTH-3 (scope only), FR-AUTH-4, FR-AUTH-5; CON-11; NFR-17. Acceptance: owner's Stage-3 list 1–18 (below) ⊇ AT-21 (service half), AT-27, AT-28, AT-31.

## Frozen shared contract (lead owns; changes only via the lead)
**Driver facts (apps/web/lib/server/db.ts, Neon HTTP 1.2.0):** each `query()` is its own autocommit statement; `transaction([...])` sends a fixed array of statements in ONE transaction (no branching on intermediate results). Never `BEGIN`/`COMMIT` as separate calls; never rely on `search_path`. Every atomic step below is one statement (CTE) or one `transaction([...])` batch.

Types (`apps/web/lib/server/identity.ts`, lead):
```ts
type Role = "owner" | "operator" | "viewer";
interface Principal { id: string; wallet: Address }                 // login identity (SIWE address)
interface AuthContext {                                              // built ONLY on the server
  principalId: string; businessId: string | null; role: Role | null;
  scopes: ReadonlySet<Scope>; source: "session" | "api_key"; credentialId: string; requestId: string;
}
type Scope = "account:read" | "business:manage" | "members:manage" | "policy:propose" | "policy:activate"
           | "invoices:read" | "invoices:draft" | "payments:read" | "refunds:propose" | "keys:manage" | "webhooks:manage";
class AuthError extends HttpError {}  // 401 not signed in / session expired or revoked
class Forbidden extends HttpError {}  // 403 signed in, role lacks the scope (never reveals other tenants)
// foreign/guessed ids → 404 "Not found" (FR-AUTH-1); DB unavailable → 503, protected mutations fail closed
```
Role → scopes (SRS FR-BIZ-2, verbatim basis: "Owner … approves receiving policies"; "Operator … cannot change destinations"; "Viewer reads only"): owner = all; operator = account:read, invoices:read, invoices:draft, payments:read, refunds:propose (**no** policy:propose / policy:activate — the adopted SRS gives Operators no receiving-policy right, so there is no Operator proposal path); viewer = account:read, invoices:read, payments:read. Receiving-policy proposal and activation are Owner-only. Financial execution is never a dashboard scope. *(Correction D, 2026-11-06.)*

Service signatures (owners in brackets; every service takes `ctx` first and re-reads membership per request — no cross-request authz cache):
```ts
// [Session 2 — auth]  apps/web/lib/server/auth-sessions.ts
issueChallenge({ address, chainId }, now?): Promise<{ nonce, message, expiresAt }>
// Correction E: the SERVER builds the complete EIP-4361 message from validated inputs: `address` must be a checksummable
// 20-byte EVM address (EOA only — contract wallets not supported in Stage 3); `chainId` must be in the supported set {1874};
// domain and URI come from configured PUBLIC_ORIGIN (never the request Host header); nonce = 16 random bytes (base58/hex,
// ≥ 96 bits); issuedAt = now; expirationTime = now + 10 min; statement fixed ("Sign in to Whiteflow"). The exact message
// text, address and chainId are stored with the nonce. signIn() accepts only a message that byte-equals the stored
// message for an unconsumed, unexpired nonce, recovers the signer (EOA ecrecover) and requires it to equal the stored
// address; message size bounded (≤ 2 KB). An invalid signature does NOT consume the challenge.
signIn(message: string, signature: Hex, req: Request): Promise<{ cookie: string; principal: Principal }>
signOut(req: Request): Promise<{ clearCookie: string }>           // revokes the server row
contextFromRequest(req: Request, requestedBusinessId?: string): Promise<AuthContext>   // session or API key
// [Session 3 — business]  apps/web/lib/server/businesses.ts, policies.ts
createBusiness(ctx, { displayName, timezone, idempotencyKey }): Promise<Business>       // + owner membership, atomic
// Correction B: the idempotency record stores sha256 of the normalized payload (trimmed display name, IANA timezone,
// sorted-key JSON). Same principal + key + same hash → the original business; same key + different hash → 409.
listMyBusinesses(ctx): Promise<Array<{ business: Business; role: Role }>>
setMemberRole(ctx, { businessId, principalId, role }): Promise<void>                  // owner; last owner protected
removeMember(ctx, { businessId, principalId }): Promise<void>
issueReceivingProof(ctx, { address, chainId, tokenAddress, proposedVersion }): Promise<{ nonce, message, expiresAt }>
issueOwnerApproval(ctx, { proofNonce }): Promise<{ nonce, message, expiresAt }>          // owner only (Correction C)
activatePolicy(ctx, { proofNonce, proofSignature, approvalNonce, approvalSignature, expectedCurrentVersion }): Promise<SettlementPolicy>
// Correction C — step-up = a fresh, purpose-bound Owner approval, distinct from the receiving-wallet proof:
//  • receiving proof (control): signed by the RECIPIENT address over {purpose:"receiving-proof", domain, businessId,
//    recipient, chainId, tokenAddress, proposedVersion, nonce, issuedAt, expiry ≤ 10 min}. Proves wallet control only.
//  • owner approval (authority): signed by the SESSION PRINCIPAL's login wallet, who must hold role=owner at activation,
//    over {purpose:"approve-receiving-policy", domain, businessId, policyHash (chain, token, recipient, version),
//    proofNonce, nonce, issuedAt, expiry ≤ 5 min}. Freshness = its own ≤ 5 min expiry (independent of session age).
//  • Both challenges are single-use, purpose-tagged (a login or receiving-proof signature can never satisfy the approval,
//    and vice versa), and consumed atomically in the SAME statement that inserts the policy version; replay → 409.
//  • Possession of the recipient signature never implies Owner authority; if the recipient happens to be the owner's
//    login wallet, both signatures are still required.
currentPolicy(ctx): Promise<SettlementPolicy | null>; policyVersion(ctx, version): Promise<SettlementPolicy>
```
UI response shapes (Session 4 consumes): `GET /api/v2/me` → `{ principal:{wallet}, businesses:[{id, displayName, role}], active:{id, role} | null, session:{expiresAt} }`; `GET /api/v2/business/policy` → `{ version, chainId, token, recipient, policyHash, approvedAt, approvedBy } | null`; errors `{ error }` with 401/403/404/409/503.

## Schema (lead owns; one additive migration `apps/web/db/053_identity.sql`, splitter-compatible, re-run safe)
`wf_principals(id PK, wallet UNIQUE lowercase, created_at)` · `wf_businesses(id PK, display_name, timezone, created_by, idem_key, request_hash, owner_count INT NOT NULL CHECK (owner_count >= 1), UNIQUE(created_by, idem_key))` · `wf_memberships(business_id FK, principal_id FK, role CHECK, created_at, PRIMARY KEY(business_id, principal_id))` · `wf_sessions(id PK, token_hash UNIQUE, principal_id FK, created_at, last_auth_at, expires_at, revoked_at)` · `wf_challenges(nonce PK, purpose CHECK('login','receiving'), principal_id NULL, business_id NULL, address, chain_id, payload jsonb, message, expires_at, consumed_at)` · `wf_settlement_policies(business_id FK, version, chain_id, token_address, recipient, policy_hash, approved_by, challenge_nonce UNIQUE, created_at, PRIMARY KEY(business_id, version))` (insert-only; no UPDATE/DELETE path in code) · `wf_audit_events(id PK, business_id NULL, actor_principal_id, source, credential_id, request_id, action, target, outcome, detail jsonb, at)`.
Atomic patterns: workspace + owner = one CTE (`WITH b AS (INSERT … ON CONFLICT (created_by, idem_key) DO NOTHING RETURNING id) INSERT INTO wf_memberships SELECT …`) then read-back by idem key; challenge consume + session insert = one CTE guarded by `consumed_at IS NULL AND expires_at > now`; policy activation = one CTE inserting version = expected+1 only if `max(version)` = expected (unique PK → loser gets 409); last-owner protection *(Correction A)*: a `COUNT(owner) > 1` predicate is NOT safe — under READ COMMITTED two statements changing different membership rows each see 2 owners in their own snapshot. Instead every membership change that adds or removes an owner is ONE statement that also updates the business row's `owner_count` (`UPDATE wf_businesses SET owner_count = owner_count - 1 …` in the same CTE as the membership update/delete). The business row lock serializes membership changes per business, the decrement is re-evaluated on the latest row version, and `CHECK (owner_count >= 1)` makes the second of two concurrent self-demotions fail atomically (whole statement rolls back → 409). Creation sets `owner_count = 1` in the same CTE as the owner membership. Test (real Postgres, independent connections, deterministic overlap): two Owners concurrently demote/remove themselves → exactly one succeeds, the other gets 409, exactly one Owner remains, `owner_count` equals the real count.

Session format: opaque 32-byte random token in an HttpOnly, SameSite=Lax, Secure-on-HTTPS, Path=/ cookie; only `sha256(token)` stored; 8 h expiry, server-side revocation; mutations require same-origin (`Origin`/`Sec-Fetch-Site`). Legacy self-contained HMAC cookie (`mc_session`, `{a,e}`): **not accepted** after cutover (one tested path: old cookie → 401 → sign in again); no legacy bypass.

Backfill (lead): one principal + business + owner membership per distinct legacy merchant wallet; no settlement policy is auto-created (receiving proof is a separate step); wallets with V1 Capital obligations flagged for V2 refusal (CON-11). Dry-run mode prints counts only.

## Review round 1 resolutions (non-author reviewer, 2026-11-06) — SUPERSEDE earlier text where they differ
**Schema deltas (migration 053):** `wf_challenges.purpose` CHECK adds `'approval'`; `wf_challenges.created_at`. `wf_settlement_policies` stores `proof_nonce UNIQUE` and `approval_nonce UNIQUE` (replacing the single challenge_nonce). `wf_businesses`: `idem_key NOT NULL`, `legacy_merchant TEXT UNIQUE NULL`, `v1_obligations BOOLEAN NOT NULL DEFAULT false`. `app_gw_keys.business_id NULL` (backfilled). `wf_sessions.active_business_id NULL`. New `wf_idempotency(business_id, operation, key, request_hash, response jsonb, created_at, PRIMARY KEY(business_id, operation, key))`. New `wf_notifications(id, business_id, principal_id, kind, detail jsonb, created_at, read_at)` (in-app only). `wf_audit_events` adds `role`, `version_hash`. Memberships have no `ON DELETE CASCADE`.

| # | Sev | Resolution |
|---|---|---|
| 1 | high | Third challenge purpose `approval`; the policy row keeps both nonces (FR-BIZ-4 approval evidence). |
| 2 | high | Owner-count deltas are derived inside the statement, never from an earlier read. Demote: `UPDATE wf_memberships SET role=$new WHERE business_id=$b AND principal_id=$p AND role='owner' AND $new<>'owner' RETURNING 1`, then `owner_count - 1` only if a row returned. Promote: `… AND role<>'owner' AND $new='owner'`, then `+1`. Remove: `DELETE … RETURNING role`, then `-1` if it was owner. Add-as-owner: `+1`. No self-join to read the old role (rechecks don't re-read joined rows). Fixed lock order everywhere: membership row, then business row. |
| 3 | high | New `addMember(ctx, { businessId, wallet, role, idempotencyKey })` (Owner only): principal upsert by wallet, membership insert, `owner_count + 1` if owner, one statement. Test 10 uses it to get a second Owner. |
| 4 | high | Legacy link: `legacy_merchant` is backfilled with the existing merchant wallet; `app_gw_keys.business_id` is backfilled. After cutover the existing v1 gateway routes resolve `contextFromRequest` → membership → business → `legacy_merchant` (replacing `signedInMerchant`). A business with no `legacy_merchant` gets 409 "not available for this workspace yet" on v1 gateway routes (honest; Stage 4 brings Whiteflow invoices). A removed or demoted member loses legacy access on the next request. API keys take `business_id` only from `app_gw_keys`. |
| 5 | high | Concurrency harness = the Stage 2 pattern: independent Node processes through the production Neon HTTP driver against the isolated `wf_s2_*` databases (kept for Stage 3 by owner decision), released by a stdin barrier, plus PGlite unit tests for logic. If the database config is absent, the concurrency suite fails (exit 1); it never skips. |
| 6 | med | In the activation statement, every challenge-consuming UPDATE's WHERE also requires current max(version) = `$expected`, `proof.payload->>'proposedVersion' = $expected + 1`, and actor-is-owner, so a lost race consumes nothing. A PK collision still rolls back the whole statement. |
| 7 | med | Activation and member-management statements lock the actor's own membership row `FOR SHARE` (re-checked after waits) and require role = owner. They also require `ctx.principalId = approval.principal_id`, and approval, proof and ctx must name the same business. |
| 8 | med | FR-AUTH-4 applies in full: `createBusiness`, `addMember`, `setMemberRole`, `removeMember` and `activatePolicy` take idempotency keys via `wf_idempotency`. Same key + same hash returns the stored response; a different hash returns 409. The record is written in the same statement or batch as the mutation. |
| 9 | med | Policy activation writes an in-app `wf_notifications` row for every other Owner (no email in Stage 3). Step-up = the purpose-bound ≤ 5 min Owner approval signature, which replaces the SRS §8.H reversible engineering choice "sign-in within 10 min"; it is stronger, and is recorded in the tracker. The receiving proof uses EIP-4361 text (purpose in the statement; the policy hash in resources). Acceptance 18 adds the confirmation screen: full address, copy, explorer link, network, exact token, explicit confirm. |
| 10 | med | `wf_sessions.active_business_id`. `POST /api/v2/me/active-business` switches only to a business with a membership (else 404). `contextFromRequest` uses the session's active business. API keys ignore any requested id (their business is fixed) and 404 a mismatching one. |
| 11 | med | Audit adds `role` and `version_hash`. Success rows are written in the same statement or batch as the mutation; denied attempts (403/409) write a best-effort row after the refusal. Sign-in and sign-out are audited. |
| 12 | med | CON-11: `v1_obligations` is set by the backfill from the V1 CapitalMarket reads (`hasClaimsOn`/`liensOf`/`advanceOf`) and re-read at activation for the recipient. If that read fails, activation is refused (fail closed, 503). Applies to V2/new routes only; V1 collection continues. |
| 13 | med | Backfill uses a deterministic `idem_key = 'backfill:v1'` per legacy wallet and sets `owner_count = 1`. Re-run safe (tested twice on the `_prev` database). |
| 14 | low | CSRF: cookie-authenticated unsafe methods need `Origin` equal to `PUBLIC_ORIGIN` or `Sec-Fetch-Site: same-origin`; if both are missing, 403. This also covers signIn/signOut (login CSRF). Bearer-only (API key) requests are exempt. |
| 15 | low | `PUBLIC_ORIGIN` unset → auth endpoints answer 503 (no Host fallback). `Secure` comes from the `PUBLIC_ORIGIN` scheme. Cookie name: `wf_session`. |
| 16 | low | `issueChallenge` is rate-limited per IP (`sharedRateLimit`, closed); expired challenges are pruned. The principal upsert happens inside the sign-in CTE. |
| 17 | low | NFR-17: no session tokens, signatures or challenge messages in logs or in audit `detail`; enforced by a grep test over captured logs. |
| 18 | low | Public flows stay login-free: checkout, receipt, quotes, hosted links/pages and `pk_` paths, each with an explicit regression test. |
| 19 | low | Item 14 = existing settlement-policy versions and their hashes never change (no UPDATE path; tests assert immutability); invoices bind to policy versions in Stage 4. Item 17 = backfill on `_prev` with synthetic legacy rows: principals, businesses and memberships created; gateway rows linked; no row lost; re-run idempotent; obligation flag set for a synthetic lien fixture. |

## Review round 2 resolutions (same reviewer, 2026-11-06) — SUPERSEDE earlier text where they differ
**R2-1 (high) v1 route → scope map** (enforced in each route via `contextFromRequest` + `require(ctx, scope)`; FR-BIZ-2 roles):
| Route (apps/web/app/api/v1/…) | Scope | Roles |
|---|---|---|
| `keys` GET/POST, `keys/[id]` DELETE | keys:manage | Owner |
| `webhooks` GET/POST, `webhooks/[id]` DELETE, `webhooks/[id]/test` POST, `webhooks/deliveries/[id]/replay` POST | webhooks:manage | Owner (and `sk_` keys, for API compatibility) |
| `capital/offers/[id]/publish` POST | business:manage | Owner |
| `links` POST, `links/[id]/cancel` POST, `pages` POST, `vouchers` POST, `vouchers/[id]/deactivate` POST, `vouchers/[id]/publish` POST | invoices:draft | Owner, Operator |
| `payments/[id]/refunds/sync` POST | refunds:propose | Owner, Operator |
| `links` GET, `pages` GET, `vouchers` GET | invoices:read | all |
| `reports` GET, `reports.csv` GET, `settlements` GET | payments:read | all |
| `capital/merchant` GET | account:read | all |
| `sessions` POST, `sessions/[id]` GET, `payments` GET (API-key routes) | checkout:create / payments:read | `sk_` keys |
API keys have a fixed scope set: `sk_` = {checkout:create, payments:read, invoices:read, webhooks:manage}; `pk_` = {} (refused, as today). Keys never get members, policy, keys or business management. Only Owners create or revoke keys.

| # | Sev | Resolution |
|---|---|---|
| R2-2 | med | Postgres deadlock `40P01` and serialization `40001` map to a retryable 409 ("Someone else changed this team at the same time. Try again."). Test 10 adds the pair "Owner A removes B while B removes A": one succeeds, the other gets 409, and at least one Owner remains. |
| R2-3 | med | `setMemberRole`: if the new role is not owner, run the demote form first; if it returns no row, run the non-owner form (`… AND role<>'owner'`) as a separate statement; if both return nothing → 404. If the new role is owner, run the promote form. Never a generic `SET role=$new`, and never two updates of one row in one statement. |
| R2-4 | med | The idempotency record is a plain `INSERT INTO wf_idempotency` in the same statement/batch as the mutation: a duplicate errors (23505) and rolls the mutation back. The service tells the idempotency constraint apart from domain constraints by constraint name, then reads back the stored row: same hash → stored response; different hash → 409. No `ON CONFLICT DO NOTHING`. The key gains `principal_id`: `PRIMARY KEY(business_id, principal_id, operation, key)`. |
| R2-5 | med | Deterministic overlap: a holder process opens an interactive transaction through the same package's WebSocket `Pool` (`@neondatabase/serverless`), takes `SELECT … FOR UPDATE` on the contested business or membership row, the contenders are fired, `pg_stat_activity` shows them waiting with `wait_event_type='Lock'`, then the holder commits. The barrier remains for start alignment. Test-only use of `Pool`; production keeps the HTTP driver. |
| R2-6 | low | Every data-modifying sub-statement references the actor CTE in its WHERE (an unreferenced locking CTE could be skipped). |
| R2-7 | low | Each challenge consume is gated on the other challenge also being valid (unconsumed, unexpired, right purpose, same business), so one invalid challenge never burns the other. |

## Lanes (owner's four-session plan)
| Session | Lane | Files (one writer each) | Reviews |
|---|---|---|---|
| whiteflow-ef (lead) | contract, schema/migration 053, identity.ts types, backfill, integration, evidence | db/053_identity.sql, lib/server/identity.ts, scripts/backfill-identity.mjs | Session 4's UI/tests |
| whiteflow-b7 | Session 2 — authentication | lib/server/auth-sessions.ts, app/api/v2/auth/**, lib/auth.ts (migration of the old cookie path), test/auth-*.test.mjs | lead's schema/context |
| whiteflow-0f | Session 3 — business authorization & policy | lib/server/businesses.ts, lib/server/policies.ts, app/api/v2/business/**, test/biz-*.test.mjs | Session 2 |
| whiteflow-fb | Session 4 — minimal UI + browser acceptance | app/(workspace)/** minimal pages, components it creates, test/e2e or browser scripts | Session 3 |

## Acceptance (owner's Stage-3 list) → evidence
1 SIWE sign-in → durable session · 2 wrong domain/URI/nonce/chain/expired fail · 3 replay incl. concurrent (real PG) · 4 logout kills copied cookie · 5 expired/revoked fail · 6 role/business manipulation can't elevate · 7 guessed ids → 404 · 8 Operator/Viewer cannot propose, activate or change the effective receiving policy, or manage members/roles (Owner-only per FR-BIZ-2) · 9 removal/demotion effective next request · 10 workspace never without owner, incl. two Owners concurrently demoting themselves (real PG concurrency) · 10b same idempotency key + different payload → 409 · 11 login proof ≠ receiving proof · 12 receiving proof bound to business/address/chain/expiry · 13 concurrent policy updates keep versions (real PG) · 14 existing references not redirectable · 15 DB outage fails closed · 16 no regressions (gateway, checkout, Stage 2) · 17 legacy migration preserves records/obligations · 18 browser journey sign-in → workspace → proof → policy → logout.

## Out of scope
Stage 4 invoices/contracts, MCP, cross-chain, World, Arkiv publication, auth vendors/passkeys, visual redesign.
