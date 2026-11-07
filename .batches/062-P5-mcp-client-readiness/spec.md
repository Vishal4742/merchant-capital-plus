# Spec: 062-P5-mcp-client-readiness

## Requirements
FR-MCP-6, FR-MCP-7, FR-MCP-10, FR-MCP-11; FR-AUTH-1, FR-AUTH-2, FR-AUTH-4.

## Scope
Integrate existing batch 058 remote connector with current main and business identity. Preserve supported tools and testnet limitations. No new financial tools, deployment, migrations against external databases, or production activation.

## Acceptance
- Merge conflicts resolved preserving current identity and remote MCP protections.
- Consent and revoke use current workspace authentication; removed membership cannot retain connector authority.
- Page provides direct URL and client-specific OAuth registration instructions, honest unavailable/errors and verification state.
- OAuth discovery, PKCE, audience, refresh rotation, revocation and idempotent links pass local tests.
- Web typecheck/lint/build and MCP checks run on Node 26; hosted/client acceptance explicitly remains pending until evidenced.

## Files
Existing batch 058 web/MCP/connector files, affected merge conflicts, focused tests, this batch evidence.

## Minimum implementation
Reuse SDK OAuth server and existing gateway services. Integrate rather than replace them.

## Out of scope
Production go-live, funds movement, new dependencies, new invoice/customer backend, cross-chain work.
