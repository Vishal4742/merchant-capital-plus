# SRS-CHANGE 058: hosted assistant connection (for claude-research to apply)

**Status:** approved by the human, 2026-11-07 (batch 058 continuation brief: "I approve: SRS changes FR-MCP-18, FR-MCP-19 and FR-MCP-20 as described in DELIVERY.md"). The lane does not edit `docs/SRS.md` (PIPELINE.md §3, §6): claude-research applies it and bumps the SRS version. Posting to agentbus was not possible from this Windows session (`tools/agentbus.py` needs `fcntl`), so this file is the message: please relay or apply it.

## Gap to fix in the same edit

`docs/SRS.md` on main (v2.0, 2026-11-07) lists FR-MCP-1..5 only. The code and comments of batches 052/054/058 cite **FR-MCP-12..17 and FR-GW-16**, which the human approved in batch 052 round 2 (`.batches/052-PW5-merchant-mcpb/batch.md:30`, `production-plan.md:48`) but which were never written into the SRS. FR-MCP-6..11 do not exist. Suggested: add FR-MCP-12..17 and FR-GW-16 from the 052 batch files verbatim, then the three rows below (keep 18..20: they are cited in the code). Do not reuse IDs.

## New rows (section 3.10, Assistant connector)

| ID | Requirement | Pri | Phase |
|---|---|---|---|
| FR-MCP-18 | **Hosted endpoint.** WhiteFlow serves the six merchant tools (`get_business_profile`, `create_payment_link`, `get_payment_link`, `list_payments`, `get_collection_summary`, `get_operation_status`) over HTTPS Streamable HTTP at one public URL (`WHITEFLOW_MCP_PUBLIC_URL`), Whitechain Testnet only. It is stateless (every request authenticated, no session as credential), keeps its write journal in shared Postgres namespaced by merchant, and fails closed (503) when unconfigured: no sandbox or localhost fallback. Customers, invoices and reminders are not offered until a real backend exists. The local stdio/.mcpb connector (FR-MCP-1..3, 12..17) is unchanged | M | 5 |
| FR-MCP-19 | **Delegated authorization.** The endpoint is protected by OAuth 2.1 authorization code with PKCE S256 only, discovery (RFC 9728, RFC 8414), dynamic registration of public clients, exact redirect matching (loopback any port), tokens bound to the endpoint's URL as audience (RFC 8707), 10-minute opaque hashed access tokens, rotating refresh tokens with reuse detection, single-use codes whose replay revokes the grant. The signed-in merchant approves on a consent screen showing the assistant, their account, Whitechain Testnet and the permissions; the grant is bound to that SIWE merchant, never to anything in a prompt. Scopes: `account:read`, `links:read`, `payments:read`, `reports:read`, and `links:write` as a separate, default-off permission, enforced at the tool call, at the gateway by method and path, and at token verification. No tool signs, sends money, refunds, changes a receiving wallet, approves an invoice or manages owners | M | 5 |
| FR-MCP-20 | **Connection states and management.** `/merchant/ai` lists each connection with one of: Setup required, Authorized awaiting verification, Verified, Reauthorization required, Revoked, Service unavailable. Verified means only that an authenticated tool call under that grant succeeded, shown with its time; copying a prompt, finishing consent and a health check never set it. Disconnect revokes the grant and its tokens, and the next tool call and refresh are refused. A public `/connect` guide with ChatGPT and Claude setup prompts holds no merchant data or secret and says setup is unavailable when the service is not switched on | M | 5 |

## Acceptance tests (proposed IDs)

| ID | Scenario | Pass criteria |
|---|---|---|
| AT-19 | In ChatGPT, then separately in Claude: add the WhiteFlow connector from the `/merchant/ai` prompt, approve read access, ask for the business profile | The consent screen names the assistant, the merchant and Whitechain Testnet; the profile call succeeds and the grant reads Verified with that time; the grant was never Verified before the call |
| AT-20 | Re-authorize with `links:write`, ask for a payment link, then Disconnect | The link exists under that merchant with the requested amount; after Disconnect the next tool call and the next refresh are refused |
| AT-21 | The customer pays that same link with test USDT | The chain receipt, the dashboard and `get_payment_link` / `list_payments` agree on payment id, amount and fee |

Cross-references: batch 058 `DELIVERY.md` (design, scope map), `spec.md`. Tests that pin these today: `apps/mcp/test/oauth-flow.test.ts`, `apps/web/test/mcp-{principal,grants,consent}.test.mjs`, `packages/mcp/test/{remote,pg-journal}.test.ts`.
