# Demo shop (AT-14)

A one-product coffee shop wired to the WhiteFlow gateway with the SDK (`packages/sdk`, vendored as `lib/sdk.ts`). Live webhook endpoint: https://merchant-capital-shop.vercel.app/api/webhook.

The whole integration is 20 lines:
- `api/checkout.ts`: `sessions.create` with the shop's secret key, then a 303 to the hosted checkout. The amount is set on the server.
- `api/webhook.ts`: `constructEvent` over the raw body. 400 for a bad or missing `MC-Signature`, 500 while `GATEWAY_WEBHOOK_SECRET` is unset.

Run it locally (the gateway on 127.0.0.1:3100 can only be reached from this machine): put `GATEWAY_URL` and `GATEWAY_SECRET_KEY` in a git-ignored `.env`, then `npm run dev` → http://127.0.0.1:4100.

Deploy: `git archive HEAD:apps/shop` into an empty folder, `vercel link --project merchant-capital-shop`, `vercel deploy --prod`. `GATEWAY_WEBHOOK_SECRET` (and later `GATEWAY_SECRET_KEY` + a public `GATEWAY_URL`) live in Vercel env, Production only, Sensitive.

Tests: `npm test` · `npm run typecheck`.
