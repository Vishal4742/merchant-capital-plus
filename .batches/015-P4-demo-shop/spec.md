# Spec: 015-P4-demo-shop (phase mode, Money: yes)

## Requirements (cite docs/SRS.md IDs)
- **AT-14:** the demo shop adds the gateway with the SDK; integration code ≤ 20 lines; a sale completes; the webhook arrives and its signature verifies.
- **FR-GW-5:** the shop uses `packages/sdk` (`Gateway.sessions.create`, `constructEvent`, `SIGNATURE_HEADER`).
- **FR-GW-7:** the shop's endpoint is registered with `POST /api/v1/webhooks`; the gateway sends `payment.succeeded` signed with HMAC-SHA256.
- **NFR-3 / CON-7:** the shop's secret key and webhook secret only in a git-ignored `.env` (local) or Vercel env (Production, Sensitive); never printed.

## Design
- The gateway (apps/web) runs only on 127.0.0.1:3100 today, and it only sends webhooks to public HTTPS (SSRF guard, `apps/web/lib/server/webhooks.ts` `assertPublicUrl`). So the same shop code runs in two places:
  - **Vercel** (`merchant-capital-shop`): `/api/webhook` receives the gateway's webhook. `/api/checkout` works there once `GATEWAY_URL` points at a public gateway.
  - **Local** (`dev.ts`, 127.0.0.1:4100, `GATEWAY_URL=http://127.0.0.1:3100`): the shop page and `/api/checkout`, which can reach the local gateway.
- No database: the webhook handler verifies the signature, logs `type id session status amount`, and answers 200 (400 for a bad signature). The gateway's delivery record (`GET /api/v1/webhooks`) and the Vercel log are the proof.
- The deploy uploads only `apps/shop`, so `lib/sdk.ts` is a byte copy of `packages/sdk/index.ts`, pinned by a test (same as the relayer's `src/contracts.ts`).

## Acceptance criteria
- [ ] `npm test` + `npx tsc --noEmit` in apps/shop pass: good signature → 200, bad/missing → 400, checkout → 303 to the session url; copy test.
- [ ] Integration lines (shop code that touches the gateway, excluding the vendored SDK) ≤ 20, counted and reported.
- [ ] Vercel production deploy from `git archive` (no `.env` in it); `/api/webhook` unsigned → 400.
- [ ] One sale ≤ 2.49 USDT from guest 0x4f59 through the shop's checkout; tx on the explorer; the delivery shows response 200 and the Vercel log shows the verified event.

## Files to touch (owner lane: only these)
- apps/shop/** (new): `api/checkout.ts`, `api/webhook.ts`, `lib/sdk.ts` (copy), `public/index.html`, `dev.ts`, `package.json`, `tsconfig.json`, `vercel.json`, `.vercelignore`, `.gitignore`, `test/*.test.ts`, `README.md`.

## Out of scope
- An order database, refunds, the pay-button variant (FR-GW-4 is proven by claude-sdk's tests).
