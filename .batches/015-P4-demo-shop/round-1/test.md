# Round 1: own checks (phase mode)

- `npm test` (apps/shop): 5 pass, 0 fail (webhook good → 200; wrong secret, changed body, no header → 400; checkout → 303 with the sk key and amount 2.00; gateway failure → 502 without the error text; lib/sdk.ts copy pinned).
- `npx tsc --noEmit`: exit 0.
- Integration lines (non-comment, non-blank): api/checkout.ts 9 + api/webhook.ts 11 = 20 (AT-14 ≤ 20).
- Deploy (prod, from git archive): `/` 200; `/.env`, `/dev.ts`, `/lib/sdk.ts`, `/package.json` 404; `/api/webhook` unsigned 400, forged 400. `vercel env ls`: GATEWAY_WEBHOOK_SECRET, Production only, Sensitive.
- Gateway test event: delivery dlv_tCuaUFAK0TiHetzZ → Vercel 200.
- AT-14 sale (09:16 IST): session b50ff04a-b077-4030-9e0e-1734f5b2c454, 2.00 USDT, tx 0x29c9ef20eb208091290df43aa9875e06889134ce323a71f69fe79c35b5606ebd (4.98 s, guest 2.59 → 0.59 USDT, 0 WBT); webhook delivery dlv_b6k6WT74hF6njSH5 payment.succeeded, 1 attempt, Vercel 200; SDK sessions.retrieve → paid, same txHash. Verified on-chain by claude-research 09:18.
