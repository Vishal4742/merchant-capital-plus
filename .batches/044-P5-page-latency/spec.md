# Spec: 044-P5-page-latency

## Requirements (cite docs/SRS.md IDs)
- NFR-13 (merchant and investor pages: first paint ≤ 2.5 s; the dither scene and the Anon-RPC worker load after first
  paint and never block input; last-known chain data shows at once, private reads update in the background).
- NFR-12 (customer pay and checkout pages: LCP ≤ 2.0 s): measured only, nothing changed on those pages.
- NFR-5 (one batched read per screen, no event-log scans): the fee receipts are the one per-row read left; caching keeps
  repeat views at zero receipt calls.
- Constraint kept: security review 005 F-N4 (a soft navigation must never run a page under another route's CSP).

## Measurements (before, production https://merchant-capital.vercel.app, from Mumbai, 2026-11-06 ~17:30 IST)
curl -w, 3 runs each; the edge is bom1, functions run in iad1 (`x-vercel-id: bom1::iad1::…`), TCP connect 6 ms.

| Route | TTFB | Full response | Notes |
|---|---|---|---|
| `/` | 32 / 32 / 50 ms | 33 / 33 / 51 ms | fully static, `x-vercel-cache: HIT` |
| `/docs` | 60 / 50 / 28 ms | 1786 / 365 / 750 ms | ◐ PPR: shell at once, the dynamic hole streams from iad1 |
| `/capital` | 47 / 27 / 23 ms | 404 | PR #33 not deployed yet |
| `/l/A7L1BDRvyn` | 31 / 29 / 26 ms | 1254 / 456 / 247 ms | ◐ shell from the edge, link read from Postgres in iad1 |
| `POST /l/A7L1BDRvyn/checkout` (303) | 440 / 274 / 359 ms | same | creates the session row (no money moves) |
| `/checkout/<id>` (2 sessions × 3) | 37 / 27 / 36, 34 / 32 / 26 ms | 379 / 328 / 296, 490 / 269 / 299 ms | ◐ |
| `/merchant/payments` signed out | 726 / 35 / 43 ms | 1020 / 485 / 288 ms | cold instance on run 1 |
| `GET /api/v1/capital/offers` | 1372 (cold) / 427 / 482, then 504 / 436 / 402 ms | same | chain offers + Arkiv rows (rows already cached 10 s) |

`npm run build`: every page route is ◐ (Partial Prerender) except `/`, `/proofs`, `/capital`, `/capital/holdings` (○).
So every page already sends a static shell from the edge in < 60 ms; what the user waits for is the dynamic hole
(~250–500 ms warm, Mumbai ↔ iad1 plus the reads) and, on the dashboard, a **full document load on every click**.

## Top causes (code analysis, /merchant/* needs SIWE)
1. **Every dashboard click is a full page load.** `components/dashboard/Nav.tsx:2,51` uses plain `<a>` for all screens
   (security review 005 F-N4). Each switch re-downloads and re-hydrates the page, and `PrivateReads` reboots Anon-RPC
   (the Nym client, its two mainnet bootstrap reads and the gateway WSS) after idle, so the first reads of every screen
   go out plain. Seven screens (`/merchant`, payments, links, vouchers, reports, settlements, capital) send the
   byte-identical CSP (`next.config.ts` `/merchant/:path*`), so a client navigation among them keeps exactly the policy
   a full load would send; F-N4 doesn't apply there. `/merchant/pages` (img https:), `/merchant/developers` (strict) and
   `/docs` (strict) differ and must stay full loads.
2. **Payments: one receipt RPC per row, uncached, after two sequential index reads.** `app/merchant/payments/page.tsx:63-74`:
   Blockscout `paidLogs` → then Postgres `listPayments` (independent, sequential) → `readPayment` multicall → then up
   to 50 `getTransactionReceipt` calls (viem multicall batches only `eth_call`, so these are 50 HTTP requests to Ankr,
   with 5 × 1 s retries each). A mined transaction's fee never changes, yet it is re-read on every view.
3. **Home: Postgres after the chain.** `app/merchant/page.tsx:184-193`: `listPayments` waits for the
   relayer/invoices/index/fee `Promise.all` though it needs none of them. Its Suspense fallback is a bare line of text, so
   switching to Home drops the sidebar until the data streams.
4. Settlements (`app/merchant/settlements/page.tsx:30-33`) has the same uncached per-row `readTxFee`; that file is
   another batch's (not touched here, reported).

## Acceptance criteria
- [ ] Nav uses `next/link` (default App Shell prefetch) only between the seven same-CSP screens, and only when the
      current screen is one of them; Pages, API keys and Docs (and every link from those three screens) stay plain `<a>`.
- [ ] A test proves each soft-navigation target gets the byte-identical CSP from `next.config.ts` (fails if a rule
      changes one of them), and that Pages, Developers and Docs differ.
- [ ] Payments: `paidLogs` and `listPayments` run in parallel; fees come from a `'use cache'` read keyed by the tx hash
      only (public chain data, the same for every merchant; nothing merchant-specific is in the cached value).
- [ ] Home: `listPayments` joins the first `Promise.all`; the fallback is the Shell with the Home nav.
- [ ] `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass; before/after timings in round-1/ci.md.

## Files to touch
- `apps/web/components/dashboard/Nav.tsx`
- `apps/web/app/merchant/payments/page.tsx`
- `apps/web/app/merchant/page.tsx` (freed by the coordinator after batch 041)
- `apps/web/lib/server/tx-fee.ts` (new: the cached fee read)
- `apps/web/test/dashboard-soft-nav.test.mjs` (new)

## Ponytail ladder
- Needed: yes, the human asked; the full reload per click is the dominant cost. Already in repo: `cacheComponents` and
  `partialPrefetching` are on, every screen already has a Suspense shell, so no `loading.tsx` is needed (it would add
  nothing over the existing fallbacks). Platform: `next/link` and `'use cache'` + `cacheLife`, no new dependency.
  Minimum: a link swap behind one set, one `Promise.all`, one cached wrapper.

## Out of scope
- Pay/checkout pages, sessions/invoices APIs, wallet and signing code, settlements page, relayer, contracts.
- A shared `/merchant` layout (would keep the sidebar mounted; larger refactor of every page's `Shell` props).
- JSON-RPC batching on the server viem transport (changes every money-check read; not before the freeze).
