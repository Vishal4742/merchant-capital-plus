VERDICT: CHANGES

# Security review, batch 058-P5-ai-connect-remote-mcp, round 1

Reviewer: security. Scope: `git diff d87d3ac..HEAD` limited to apps/mcp, apps/web/lib/server/{mcp-principal,mcp-grants,keys}.ts, apps/web/lib/shop-auth.ts, apps/web/app/api/mcp, apps/web/app/merchant/ai, apps/web/components/ai, apps/web/lib/{ai-connect,ai-config}.ts, apps/web/db/051_mcp_remote.sql, packages/mcp/src/{remote,journal,journal-pg,client}.ts and packages/mcp/src/tools. I also read the SDK 1.32.2 handlers the provider runs under (authorize.js, token.js, register.js, router.js, bearerAuth.js, clientAuth.js in apps/mcp/node_modules) and the /api/v1 routes that accept the new credential. I edited no code and read no .env file.

Evidence I ran: `apps/mcp npm test` under Node 26.13.0 gave **21 pass, 0 fail**. Under the default Node 24.14.0 the suite fails to load, so CI must use Node 26.

## Blocking

### H1 (HIGH): the consent screen can't tell an attacker's client from ChatGPT or Claude (consent phishing through DCR)
- **Where:** apps/mcp/src/provider.ts:60-77 (open DCR: any https redirect, any `client_name`); provider.ts:74 (strips only C0 controls and DEL, so it keeps U+202E bidi overrides, zero-width characters and lookalikes); apps/web/app/merchant/ai/authorize/page.tsx:91-98 and :119/:129 (shows only the self-declared `client_name`); the page never shows `request.redirectUri` or its host.
- **Exploit:**
  1. The attacker calls `POST https://mcp.<ours>/register` with `{"client_name":"ChatGPT","redirect_uris":["https://attacker.example/cb"],"token_endpoint_auth_method":"none"}`.
  2. The attacker builds `https://mcp.<ours>/authorize?client_id=<theirs>&redirect_uri=https://attacker.example/cb&response_type=code&code_challenge=<own S256>&code_challenge_method=S256` and sends it to a merchant: "Your ChatGPT connection expired, reconnect here". The link is on our own domain.
  3. The signed-in merchant sees "Let **ChatGPT** use WhiteFlow?" with their own account, Testnet, and read permissions already ticked. Nothing on the screen differs from the real ChatGPT flow.
  4. The merchant clicks Approve. The code goes to attacker.example. The attacker holds the PKCE verifier, so it redeems the code and gets 30 days of rotating tokens: `payments:read` (payer addresses, amounts), `reports:read`, `links:read`, and `links:write` if it asked for it and the merchant ticked it.

  No money moves, but this is a full confidentiality breach of the merchant's business data, and the consent screen is the only control. MCP's security best practices (consent UI requirements, from my recollection of the spec; I did not re-fetch it in this review) require the consent page to show the redirect_uri the credentials will go to.
- **Fix (owner: batch 058 builder, apps/web consent page and apps/mcp provider):**
  1. On the consent page, show the redirect host prominently ("Access will be sent to **attacker.example**") next to the name.
  2. Label the name as "name given by the app, not verified" unless the redirect host is on a small known-host list (chatgpt.com, claude.ai, claude.com, plus loopback for Claude Code). Show a visible "Unverified app" warning otherwise.
  3. In registerClient, also strip Unicode format characters (`/\p{Cf}/gu`, which covers bidi and zero-width), and either refuse names that impersonate the known hosts when the redirect host isn't theirs, or prefix them as unverified.
  4. Add a test: a client named "ChatGPT" with a non-chatgpt.com redirect renders the unverified warning and the attacker host.

## Answers to the checklist (no finding unless noted)

1. **Authorization code.**
   - Spending is atomic: one `UPDATE … WHERE used_at IS NULL AND expires_at > now … RETURNING` (provider.ts:112-116). Two concurrent redemptions give one success.
   - The code is bound to client_id (provider.ts:99, :113), redirect_uri (only when the client sends one, which OAuth 2.1 with PKCE allows), resource and challenge.
   - The 60 s TTL is checked in both challengeForAuthorizationCode and the UPDATE.
   - The code is opaque 256-bit and stored as SHA-256. A replay revokes the grant (provider.ts:101-103).
   - See L3 and L4 for two edge cases.
2. **PKCE.** The SDK's schema requires `code_challenge` and `code_challenge_method: z.literal('S256')` (authorize.js). The token schema requires `code_verifier`, and `verifyChallenge` runs before exchange because `skipLocalPkceValidation` is unset. No path skips PKCE. Metadata advertises S256 only (tested).
3. **redirect_uri.**
   - The SDK's `redirectUriMatches` and the dashboard copy (mcp-grants.ts:171-176) are identical: exact match, and for loopback only the port is relaxed, with scheme, host, path and query exact.
   - Registration accepts only https, or http on loopback, with no fragment or credentials, so `javascript:` can't reach `window.location.assign` (ConsentForm.tsx:187).
   - The consent route's approve and deny redirects come only from the HMAC-signed request, and approve re-checks the registration (mcp-grants.ts:197-200).
   - Open-redirect residue: see L6.
4. **Refresh.**
   - Rotation is one atomic UPDATE (provider.ts:125-128). Of two concurrent refreshes of one token, exactly one gets the row. The other sees `used_at` set, treats it as reuse and revokes the grant.
   - If the winner's `#issue` lands after that revocation, its new tokens are still dead: verifyAccessToken checks `g.revoked_at IS NULL` and refresh re-checks `#liveGrant`.
   - Revoking a grant marks every token revoked, and every check reads the grant anyway.
   - A refresh can't widen scopes (it can't narrow them either: documented).
5. **Audience.** authorize forces `resource` to equal the MCP URL (provider.ts:84-85). The grant stores it, and `requireBearerAuth({expectedResource})` compares it on every request (bearerAuth.js `sameResource`, tested). Access and refresh tokens are kind-checked, so neither works as the other. The OAuth token never leaves apps/mcp; the gateway gets a separate `wfi1` assertion.
6. **Scope, at three layers.**
   - Tool wrapper (remote.ts:91-115): only the six tools are registered, and the others are dropped at registration, so they are not callable at all. The scope is checked at call time, and `acknowledge === true` needs `links:write`.
   - I checked that every tool module uses `registerTool`. A `server.tool()` call would have bypassed the Proxy, and grep finds none.
   - Gateway table (mcp-principal.ts:52-60): any route that isn't listed, including `GET /api/v1/links` (list), `/api/v1/sessions*` (which also accept the assertion through shopCaller), keys, webhooks and HEAD, returns 403.
   - The grant row is re-read on every request. See M2 for one route-level gap.
7. **wfi1 assertion.**
   - HMAC-SHA256 with a timing-safe compare and a length check first (mcp-principal.ts:39-40).
   - `aud` must be `whiteflow-gateway`, and `exp` is checked. The merchant must equal the grant row's merchant, and revocation, expiry and scopes come from the row.
   - It fails closed without `MCP_INTERNAL_SECRET` (≥32 characters).
   - wfc1↔wfi1 confusion: the MAC covers only the payload, not the prefix, but both verifiers require their own `aud`, and the consent payload has no `m`/`g`. Swapping the prefix doesn't verify.
   - The CSRF MAC input `csrf1|…` is not base64url JSON, so it can't be used as a tag.
   - Not checking jti is acceptable (L1).
8. **Consent.**
   - The merchant comes only from the session (consent/route.ts:16, :26).
   - The CSRF token is bound to merchant and request, with a timing-safe compare. The route is JSON-only, so a cross-site request needs a CORS preflight, which fails.
   - Clickjacking: next.config.ts sends `X-Frame-Options: DENY` on `/(.*)` and `merchantCsp` (`frame-ancestors 'none'`) on `/merchant/:path*`, which covers `/merchant/ai/authorize`. I verified this from the config, not with curl.
   - `state` is returned untouched, and `iss` is added (M1: its value doesn't match the metadata).
   - Client spoofing: H1. DCR abuse: M3.
   - Logs record error names only (index.ts:364-367). No token or code is logged.
9. **Tenant isolation.**
   - The journal scope is a hash of origin, environment and merchant. The merchant comes from `/api/v1/account` called with this grant's assertion, so it can't be chosen by the caller.
   - `listGrants` and `revokeGrant` filter by the session merchant. Revoking another merchant's grant id returns 404.
   - The /api/v1 routes take the merchant from `callerMerchant`/`shopCaller`. Operations slots and link reads are per merchant.
10. **SQL and JSON.** Every query is parameterised. Metadata is re-serialised from a whitelist (`client_name`, `redirect_uris`, fixed fields), so `logo_uri`, `jwks_uri` and the rest are dropped. JSON is parsed with type checks (verifyConsentRequest).
11. **SSRF.** The only outbound fetch from apps/mcp is the gateway, at the configured `webOrigin` (https, validated). There is no CIMD, logo or jwks fetch.
12. **Origin and transport.** `/mcp` refuses an Origin that isn't on the exact allow-list (no `null`) and allows a missing Origin for server-to-server clients. Origin is not the credential; the bearer token is. The JSON body is parsed only after bearer auth. Each request gets a fresh server and transport, with no session id; GET and DELETE return 405.
13. **DB unavailable.**
    - apps/mcp: a provider error becomes a 500 from the SDK handlers and bearer middleware, so it fails closed.
    - A failure to write `last_tool_ok_at` is swallowed, which only means "not Verified".
    - apps/web: internalCaller lets a DB error propagate to `handle()` (503). shopCaller maps a missing DATABASE_URL to 401 and other errors to 503.
    - I found no fail-open path.

## FOLLOW-UP (MEDIUM / LOW, not blocking)

### M1 (MEDIUM): `iss` in the authorization response doesn't equal the advertised issuer
- **Where:** apps/web/lib/server/mcp-grants.ts:104-107 (`issuerOf()` returns `new URL(url).origin`, for example `https://mcp.x`, with no slash); apps/mcp/src/config.ts:351 (`issuerUrl: new URL(mcpUrl.origin)`). The SDK publishes `issuer: issuer.href`, which is `https://mcp.x/`, with a trailing slash (router.js `createOAuthMetadata`).
- **Impact:** RFC 9207 §2.4 says the client compares these by simple string comparison. A client that validates `iss` rejects every authorization, and the mix-up defence it is meant to give is lost. The test (oauth-flow.test.ts:26) strips the slash before comparing, so it hides this.
- **Fix:** use one canonical issuer string in both places (pass the issuer explicitly, or use `issuerUrl.href` on both sides). Add a test that compares the redirect's `iss` byte-for-byte with `/.well-known/oauth-authorization-server`.issuer. **Owner:** batch 058 builder.

### M2 (MEDIUM): an assistant's link create can omit Idempotency-Key
- **Where:** apps/web/app/api/v1/links/route.ts:23 (`if (via === "secret_key")`). This batch adds `via: "mcp_grant"` (keys.ts:85-100), and the check doesn't cover it.
- **Impact:** a tool regression, or a replayed assertion (L1), can create links with no idempotency slot, so retries duplicate. This is defence in depth for a money-adjacent write.
- **Fix:** change the check to `if (via !== "session")`, and add a test: an assertion POST without the header returns 400. **Owner:** the gateway routes owner (PR #48 lane), or the batch 058 builder with that lane's OK.

### M3 (MEDIUM): DCR is unbounded and the limits are per instance
- **Where:** provider.ts:60-77, and the SDK limiter at 20/h per IP per instance (register.js). The token and authorize limiters are also in memory.
- **Impact:** client rows grow without a cap or expiry, and spoofed clients feed H1. Expired codes and tokens are never deleted, and `revokeToken`'s `family_id IN (…)` has no index on `family_id`, so it gets slower as the table grows.
- **Fix:** add a global per-day registration cap, a cap on redirect URI length (for example 512), deletion of clients never used in 7 days, a sweep of expired codes and tokens, and `CREATE INDEX … ON app_mcp_tokens (family_id)`. Move to a shared limiter (a Postgres counter) before launch. DELIVERY §12 already lists this gap. **Owner:** batch 058 builder.

### L1 (LOW): wfi1 jti is not checked (replay within 5 minutes)
This is acceptable as built:
- the assertion lives only inside apps/mcp and goes over TLS to the fixed webOrigin;
- it is scrubbed from outputs (`secrets: [assertion]`);
- each use re-reads the grant, so revocation and scope changes apply at once;
- a replay gives nothing beyond the grant's own scopes.

To harden it: drop the TTL to about 60 s (a tool call's retries fit), or bind the assertion to method and path. Fix M2 in any case. **Owner:** batch 058 builder.

### L2 (LOW): one secret for three purposes
`MCP_INTERNAL_SECRET` keys the consent HMAC, the gateway assertion and the CSRF tokens. Separation currently rests on `aud` and the input prefixes; I found no cross-use. Derive per-purpose subkeys (`hkdf(secret, "wfc1" | "wfi1" | "csrf1")`) so a future format change can't make one purpose's tag valid for another. **Owner:** batch 058 builder.

### L3 (LOW): a replayed code revokes the grant before PKCE is checked
provider.ts:101-103 runs before `verifyChallenge`. Anyone who sees a used code (it travels in the redirect URL) plus the public client_id can revoke the merchant's fresh grant: a nuisance DoS. RFC 6749 §4.1.2 endorses this, so it is acceptable. Note it in DELIVERY.

### L4 (LOW): a concurrent double redemption doesn't trigger replay revocation
Both requests read the challenge as unused, and one loses the UPDATE with a plain invalid_grant. To treat that as replay, have the loser re-read the row and revoke the grant if `used_at` is set. **Owner:** batch 058 builder.

### L5 (LOW): a consent request can be approved more than once in its 10 minutes
Each approval creates another grant and code (mcp-grants.ts:191-220). The orphan grants show as "awaiting verification" for 30 days. Record the consent `jti` as used, either in `app_mcp_codes` or in a small table with a unique constraint. **Owner:** batch 058 builder.

### L6 (LOW): open redirect through the authorization endpoint
An error in the SDK authorize handler's phase 2 (for example an unknown scope) 302s to any redirect an attacker registered through DCR, under our MCP domain. The deny button does the same after a click. This is inherent to open DCR; H1's fix, a host list or an "unverified" interstitial, would also cover it.

### L7 (LOW): the consent page runs under the dashboard CSP
`/merchant/ai/authorize` gets `merchantCsp`, whose connect-src includes cdn.jsdelivr.net, unpkg.com, raw.githubusercontent.com and `wss:`. That page holds a CSRF token and a consent request. Give it the strict `csp` that `/merchant/developers` uses (it needs no Anon-RPC). **Owner:** batch 058 builder (next.config.ts).

### L8 (LOW): metadata advertises client auth the server refuses
The metadata lists `token_endpoint_auth_methods_supported: ['client_secret_post','none']`, and registration refuses everything except `none` (provider.ts:62). This is an interop risk only. If the SDK allows it, override the metadata to `['none']`; otherwise document it.

### L9 (LOW): `trust proxy 1` is correct only behind Vercel
app.ts:237. Behind a different proxy topology, X-Forwarded-For is spoofable and the rate limiters can be bypassed. Note in DELIVERY §9 that apps/mcp must be served only through Vercel.

## Secret scan
`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the batch's changed files (no .env file is included; package-lock gave 0 hits) found:
- apps/mcp/src/config.ts:35, :36, apps/mcp/src/internal.ts:5, apps/web/lib/server/mcp-principal.ts:8, :23, :25: the env var **name** `MCP_INTERNAL_SECRET` only, no value.
- apps/mcp/test/helpers.ts:17: `SECRET = "mcp-internal-test-secret-0123456789abcdef"`, a labelled test fixture, not a credential. It is also used at helpers.ts:70, :87, :115 and oauth-flow.test.ts:7, :72.

No private key, real token or 64-hex value was found.

## Not applicable to this batch
Contracts (EIP-3009, payouts, mint/burn) and relayer (allowlist, simulate, gas, budget): the batch doesn't touch them, and I confirmed no tool signs or moves funds. Web: no third-party trackers were added, no PII is written to chain or Arkiv, and there is no webhook code in scope.
