# Spec: 016-P4-web-direct-server-reads

Request: claude-research 08:20, G4 phase review code M4: "now the backend is on main, call lib/server directly and delete gateway-preview.ts and most of gateway-client.ts"; security review 010 F2 (the shared rate-limit bucket on Vercel). Phase mode, Money: yes (hosted checkout routes, rate limits).

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-1, FR-GW-2, FR-GW-3: hosted /l and /p, the counter view and the dashboard lists read `lib/server/*` directly. Nothing calls our own /api/v1 over HTTP from the server, so they work under Vercel Deployment Protection and the per-IP checkout limit sees each payer.
- FR-GW-9/10/12, FR-GW-6/7: the Vouchers, Reports, Settlements and Developers screens read directly too.
- FR-PAY-7 / NFR-6: a failed read shows the same plain notice. Error details are logged by name only.
- FR-GW-5 (Payments LOW): the fee line says "fees shown for the newest 50" past 50 rows, and counts only failed reads as unread.

## Acceptance criteria
- [ ] `lib/gateway-server.ts` has no `selfOrigin` / `transportFor` / `gatewayFor`. `openCheckout` calls `payLink` / `payPage` with the payer's `x-forwarded-for`, so the backend's `checkout:<ip>` limit (20 a minute) counts each payer, once.
- [ ] `lib/gateway-preview.ts` and `lib/gateway-dev-preview.ts` and the GATEWAY_PREVIEW mode are deleted. The tests that covered behaviour run on PGlite.
- [ ] The hosted and counter pages call `await connection()` (no database read during prerender). An unknown counter id shows the 404 page.
- [ ] typecheck, lint, `npm test`, build; `grep selfOrigin|transportFor|gatewayFor|GATEWAY_PREVIEW` is empty.

## Files
- **Edited:** `apps/web/lib/gateway-{server,client,money,dev}.ts`, `apps/web/app/{l,p}/[slug]/page.tsx`, `apps/web/app/counter/[kind]/[id]/page.tsx`, `apps/web/app/merchant/{links,pages,vouchers,reports,settlements,developers,payments}/page.tsx`, tests
- **Deleted:** `apps/web/lib/gateway-preview.ts`, `apps/web/lib/gateway-dev-preview.ts`
