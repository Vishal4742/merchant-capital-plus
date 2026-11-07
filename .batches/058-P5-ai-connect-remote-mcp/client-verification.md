# Client verification (batch 058): evidence log

Status on 2026-11-07: **nothing verified in a real client yet.** No staging deployment exists, so neither ChatGPT nor Claude has been connected. SDK-client and PGlite tests are recorded in DELIVERY.md and are not client evidence.

Fill one block per client, in order. A step counts only with its evidence (screenshot path, timestamp, grant id prefix, link id). Never paste tokens, codes or secrets here.

## Hosted staging preconditions

| Check | Result | Evidence |
|---|---|---|
| `tools/staging-smoke.sh` all ok | NOT RUN | |
| `/ready` reports the hosted database | NOT RUN | |
| `apps/mcp/scripts/staging-concurrency.mjs` (20 calls, one key) → one distinct link | NOT RUN | |
| Consent page shows "Access is sent to chatgpt.com / claude.ai" for the real clients | NOT RUN | |

## ChatGPT

Official steps re-checked on: (date, URL)

| Step | Result | Evidence |
|---|---|---|
| Copy the ChatGPT prompt from staging `/merchant/ai` | NOT RUN | |
| Add custom MCP server with the staging URL; OAuth | NOT RUN | |
| Consent screen: app ChatGPT, host chatgpt.com, merchant, Testnet; read access only | NOT RUN | |
| Grant reads "Authorized, awaiting verification" before any call | NOT RUN | |
| Ask for the business profile → `get_business_profile` succeeds | NOT RUN | |
| Grant reads Verified with that time | NOT RUN | grant-list screenshot |
| Re-authorize with `links:write`; create a testnet payment link; `get_payment_link` / `get_operation_status` agree | NOT RUN | link id |
| Disconnect; next tool call refused; refresh refused | NOT RUN | |

## Claude (app)

Official steps re-checked on: (date, URL)

| Step | Result | Evidence |
|---|---|---|
| Copy the Claude prompt from staging `/merchant/ai` | NOT RUN | |
| Customize → Connectors → Add custom connector with the staging URL | NOT RUN | |
| Consent screen: app Claude, host claude.ai or claude.com, merchant, Testnet; read access only | NOT RUN | |
| Grant reads "Authorized, awaiting verification" before any call | NOT RUN | |
| `get_business_profile` succeeds | NOT RUN | |
| Grant reads Verified with that time | NOT RUN | grant-list screenshot |
| Re-authorize with `links:write`; create a testnet payment link; status agrees | NOT RUN | link id |
| Disconnect; next tool call refused; refresh refused | NOT RUN | |

## Final payment journey (separately authorised; not requested yet)

| Step | Result | Evidence |
|---|---|---|
| Exact link, merchant, network, token, amount, fee and payer wallet presented and approved | NOT RUN | |
| That link paid from the approved test wallet (never a deployer key) | NOT RUN | tx hash |
| Chain receipt, dashboard and MCP results agree | NOT RUN | |
