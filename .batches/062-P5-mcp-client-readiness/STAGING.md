# Staging configuration for the integrated connector

Status: resources not created (owner confirmed). No deployment or external migration performed.

Use a fresh Neon project/database and two separate Vercel projects: whiteflow-staging-web (apps/web) and whiteflow-staging-mcp (apps/mcp). No direct Vercel deployment: use repository staging workflow after its checks pass. Do not copy a production database or its credentials.

## Web project environment
DATABASE_URL: isolated staging database.
PUBLIC_ORIGIN: assigned staging web HTTPS origin.
AUTH_SECRET: fresh random secret.
MCP_INTERNAL_SECRET: fresh random secret shared only with staging MCP.
WHITEFLOW_MCP_PUBLIC_URL: staging MCP HTTPS URL ending /mcp.
WHITEFLOW_MCP_REMOTE: on.
NEXT_PUBLIC_PRIVY_APP_ID: configured Privy application for staging; allow the staging web origin.
PRIVY_VERIFICATION_KEY: matching Privy verification public key.
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: optional, if required for selected wallet setup.
VOUCHER_HASH_SECRET: fresh random secret if running the gateway.
Retain public testnet contract/network configuration. Do not configure payment signing credentials for connector acceptance.

## MCP project environment
DATABASE_URL: same isolated staging database as web.
MCP_INTERNAL_SECRET: same fresh value as staging web.
WHITEFLOW_WEB_ORIGIN: staging web HTTPS origin.
WHITEFLOW_MCP_PUBLIC_URL: this project's public HTTPS URL ending /mcp.
Never enable WHITEFLOW_MCP_ALLOW_LOOPBACK in hosting.

## GitHub staging environment
Secret: STAGING_DATABASE_URL.
Variables: VERCEL_STAGING_WEB_PROJECT_ID, VERCEL_STAGING_MCP_PROJECT_ID, STAGING_WEB_URL, STAGING_MCP_URL.
Existing deploy credential must have access to those staging projects. Verify project IDs before running.

## Acceptance
Run staging guard then all migrations, including 053_identity, 054_legacy_claim and 055_mcp_workspace; never cherry-pick just MCP SQL.
Sign in through Privy, create/select a workspace as Owner and link its legacy receiving wallet. Return to the saved OAuth consent request; restart connection if it expires.
Configure ChatGPT custom MCP with OAuth and Claude custom connector with OAuth / Register automatically. Verify profile; explicitly authorize links:write and create a test link; query it; disconnect and confirm denial. Verify membership removal/demotion invalidates access. Run hosted duplicate-request check.
Do not claim Verified from health, prompt copying or consent alone. Do not claim compatibility with clients that have not been tested.

## Approval/release boundary
The existing repository approval packet records owner-only staging resource setup and a separate deployment gate. Finish local tests and independent reviews before presenting the exact staging deployment for approval. Production activation remains separate.
