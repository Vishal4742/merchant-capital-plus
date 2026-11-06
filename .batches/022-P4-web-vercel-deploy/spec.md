# Spec: 022-P4-web-vercel-deploy

Request (verbatim, human 10:12): "Yes, deploy it (Recommended)": deploy apps/web to the Vercel project merchant-capital-web, in US East next to Neon and the relayer. claude-research 10:09: DB trips ~250 ms from Mumbai vs ~1-5 ms in iad1; it also gives the README its live app URL (SR-WC-4, Demo line). Phase mode, Money: yes (a public payments app), so one reviewer-security pass on the deployed config.

## Requirements (cite docs/SRS.md v2.0 IDs)
- NFR-4: the gateway's database reads and its relayer calls run in iad1, the same region as Neon (aws-us-east-1) and the relayer.
- FR-GW-14: the deployed app is test mode only (Whitechain testnet; the strip on every page).
- NFR-12 / CSP: the same per-route CSP as on :3100.
- Secrets live only in Vercel's environment settings, set by the human. Claude sets only non-secret config (public addresses, URLs) and never prints a value.

## Acceptance criteria
- [ ] `apps/web/vercel.json`: `{"framework": "nextjs", "regions": ["iad1"]}`. The project's preset was "Other".
- [ ] Non-secret production env set by Claude: MERCHANT_ADDRESS, MERCHANT_NAME, MERCHANT_PAY_ADDRESS, RELAYER_URL (the Vercel relayer), PUBLIC_ORIGIN (https://merchant-capital-web.vercel.app).
- [ ] Secret production env set by the human: SHOP_API_KEY, AUTH_SECRET, RELAY_API_SECRET, DATABASE_URL, VOUCHER_HASH_SECRET, ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY, CRON_SECRET.
- [ ] `vercel deploy --prod` builds. Live checks: /, /docs, /merchant and /checkout answer 200; the per-route CSP matches :3100; /api/v1/sessions without a key gives 401.
- [ ] ~~One confirm payment on the live URL~~ moved to batch 023 (sessions in Neon): security review 022 finding 1 showed checkout sessions live in one instance's memory, so a live checkout can't be paid until they move to Neon. Not a config issue.

## Files
- `apps/web/vercel.json` (new)
- `apps/web/.vercelignore` (new): the CLI upload never includes `.env*`, `.next`, `node_modules` or local test output, so no local secret can reach the deployment's source.
