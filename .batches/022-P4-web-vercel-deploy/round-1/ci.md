VERDICT: PASS

# CI, batch 022-P4-web-vercel-deploy (phase mode, Money: yes; run by claude-frontend at 10:28)

| Check | Result |
|---|---|
| `vercel deploy --prod` | Ready. Production: https://merchant-capital.vercel.app (the human asked for the short URL; the project domain is on merchant-capital-web; the old https://merchant-capital-web.vercel.app still works). Region iad1. |
| Live pages (curl) | /, /docs, /merchant and /checkout/x give 200, public with no login wall. The test-mode strip is on. |
| Live API | POST /api/v1/sessions without a key gives 401; the dashboard APIs give 401. |
| CSP per route | Matches :3100. /merchant has the Nym hosts; /merchant/developers, /checkout and /docs are strict. |
| Env | 5 public values set by Claude (MERCHANT_ADDRESS, MERCHANT_NAME, MERCHANT_PAY_ADDRESS, RELAYER_URL, PUBLIC_ORIGIN). 8 secrets set by the human via their own command (no values printed); production AUTH_SECRET is fresh. |
| Upload | `.vercelignore` covers `.env*`. Security confirmed no `.env*` in the deployment source and no secret in any served page or chunk. |

The live checkout payment moved to batch 023 (sessions in Neon): checkout sessions are in process memory, which fails closed across Vercel instances.
