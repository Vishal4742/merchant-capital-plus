# W2 — identity and service boundary (design draft; becomes a batch spec after SRS v3.0 approval)

Delivers proposed FR-BIZ-1–4, FR-BIZ-6 (disclosure only), FR-AUTH-1–5. Exit evidence: AT-27, AT-28, AT-31 at service level; policy-change invalidation test; migration + backfill + rollback plan. No UI redesign here (W3), no MCP (W5).

## Schema (new migration files; additive; existing `app_gw_*`/`app_web_*` untouched)
- `wf_principals(id, kind 'wallet', wallet_address UNIQUE lowercase, created_at)` — the signed-in account. Wallet SIWE stays the first login method.
- `wf_businesses(id, display_name, timezone IANA, status 'active'|'suspended', created_at)`.
- `wf_memberships(business_id, principal_id, role 'owner'|'operator'|'viewer', created_at, revoked_at, PRIMARY KEY(business_id, principal_id))`; at least one active owner per business (enforced in the service, checked in tests).
- `wf_sessions(id random 32 B, principal_id, active_business_id, created_at, last_auth_at, expires_at, revoked_at)` — cookie carries the session id only (FR-AUTH-2). Step-up = `last_auth_at` within 10 min (testnet value, labelled).
- `wf_wallet_proofs(id, business_id, address, chain_id, nonce UNIQUE, message, signature, issued_at, expires_at, consumed_at)` — single-use EIP-4361 challenge (domain, uri, chain id 1874, nonce, issued/expiration ≤ 10 min, statement "Prove control of this receiving wallet for <business>"). EOA `ecrecover` only.
- `wf_settlement_policies(business_id, version, chain_id, token_address, recipient, policy_hash, approved_by, wallet_proof_id, created_at, PRIMARY KEY(business_id, version))` — insert-only (no UPDATE path in code; DB trigger-free so the splitter keeps working). `policy_hash = keccak256(abi.encode(business_id, version, chain_id, token, recipient))`.
- `wf_api_keys` — successor of `app_gw_keys` with `business_id`, `scopes text[]`, prefix, hash, revoked_at (old table stays for V1 consumers until migrated).
- `wf_idempotency(business_id, operation, key, request_hash, status, response jsonb, resource_id, created_at, PRIMARY KEY(business_id, operation, key))` — written in the **same transaction** as the domain row (needs an interactive transaction: Neon `Pool`/WebSocket or `pg` for server routes; the HTTP `transaction([])` array form can't branch on the slot result).
- `wf_audit_events(id, business_id, actor_principal_id, source 'session'|'api_key'|'oauth', role, grant_or_key_id, request_id, operation, target, version_hash, result, created_at)` — insert-only.

## AuthContext (one type for dashboard, API, MCP)
`{ principalId, businessId, role, scopes: Set<string>, source, grantId|keyId|null, requestId }` produced by three adapters: `fromSession(request)`, `fromApiKey(request)`, later `fromOAuth(request)` (W5). Services take `ctx` as the first argument and call `require(ctx, 'invoices:draft')`. Role → scope map (WF§9): owner = all; operator = read + `invoices:draft`, `links:prepare`, `refunds:propose`; viewer = `*:read`. Receiving-policy approval and publication/refund approval are owner-only and require step-up. Foreign/guessed ids → 404 (never 403 with a hint). Client-supplied `business_id` is ignored except to *select* among the principal's own memberships.

## Backfill (existing data keeps working)
1. For every distinct merchant wallet in `app_gw_keys`, `app_gw_links`, `app_gw_pages`, `app_gw_vouchers`, `app_gw_webhooks`, `app_web_sessions`: create a principal + a business (display name from `MERCHANT_NAME` for the configured shop, else "Business <short address>") + an owner membership.
2. Settlement policy v1 for a backfilled business is **not** auto-created from the sign-in wallet: proving control for receiving is a separate step (FR-BIZ-3), so backfilled businesses start "not activated" for Whiteflow invoices while their V1 gateway links keep working on the old path.
3. Wallets with outstanding V1 CapitalMarket claims/liens (`hasClaimsOn`, `liensOf`, `advanceOf` on `0xecd6…0abe`) are marked `v1_obligations=true` and cannot activate Whiteflow collection (CON-11).
4. Idempotent backfill script with a dry-run mode that prints counts only.

Rollback: new tables are unused by pre-W2 code; roll back by redeploying the previous build (tables may stay). No destructive change to existing tables in W2.

## Tests (PGlite, real SQL)
- Role × service matrix: viewer mutation → 403/404, operator policy change → refused, owner without step-up → refused (AT-28).
- Tenant spoofing on every route and service: business B's ids from business A's session/API key → 404, no row changed (AT-27).
- Idempotency: same key+body → same op; changed body → 409; 20 concurrent identical requests → 1 domain row; crash between domain insert and response store → retry returns the stored op (AT-31).
- Policy: new version doesn't change existing approved invoice versions; stale wallet proof / reused nonce / wrong domain / wrong chain id rejected (AT-21 service half).
- Session revocation: logout and membership removal invalidate the cookie immediately.
- Audit: every mutation writes exactly one audit row with the right actor/source.
