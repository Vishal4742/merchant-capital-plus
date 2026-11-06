# Spec: 010-P4-web-links-pages-qr

Request: PLAN v2.0 (human 02:31) · "start us building" (02:44) · PHASES P4 `F` item 1 · UI backlog (research_notes/gateway_rea/BACKLOG.md §claude-frontend)

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-1: Payment Links. The merchant creates a link (amount, currency, description, optional expiry, single or reusable). The customer pays it through the hosted checkout. The dashboard shows each link's status and payments.
- FR-GW-2: Payment Pages. A no-code page (title, description, logo, colour, fixed items or an open amount) at a shareable URL.
- FR-GW-3: QR codes. Every link, page and invoice has a QR code to download or show at a counter.
- FR-GW-14: the test-mode strip (already in the root layout).
- FR-PAY-7 / NFR-6 on the public pages; FR-PRIV-1 (the hosted pages make no browser chain reads); NFR-12 (the hosted pages ≤ 204,800 B of JS as Chrome downloads it).

## Contract (claude-contracts' API.md, batch 007 on branch `backend`; snake_case; amounts are plain decimal strings)
- Dashboard (SIWE cookie):
  - `POST /api/v1/links {amount|null, currency, description, reference_id?, expires_at?, single_use?}` → link
  - `GET /api/v1/links` → `{links}`
  - `POST /api/v1/links/{id}/cancel`
  - `POST /api/v1/pages {title, description?, logo_url? (https), color? (#RRGGBB), currency, items[1..20] | open_amount}` → page
  - `GET /api/v1/pages` → `{pages}`
- Public:
  - `GET /api/v1/public/links/{slug}` → `{slug, merchant_name, amount, currency, description, status}`
  - `POST /api/v1/public/links/{slug}/checkout` (form: `{amount}` for open links) → **303** /checkout/<session>; 410 when not active
  - the same pair for pages: GET returns render fields + `merchant_name`; POST takes `{items:[{name, qty}]}` or `{amount}`
- The backend isn't on main until claude-contracts' batch 007 PR merges. Build against these shapes with a typed client (`lib/gateway-client.ts`) and fixtures in tests. Switching to live is just the backend being present on main.

## Acceptance criteria
- [ ] **`/merchant/links`** (in the Shell; the Nav item becomes a link):
  - create form: amount, or "customer chooses" for an open amount; currency from the six; description; optional expiry; single or reusable
  - list with status pills (active, paid, expired, cancelled), payments count, copy link, **QR**, cancel (two-step)
  - empty, loading and error states in plain words
- [ ] **`/merchant/pages`:** create form (title, description, logo URL, colour, currency, items or an open amount with min/max) with a **live preview** of the hosted page; list with copy link, QR, view.
- [ ] **QR (FR-GW-3):**
  - rendered on the **server** as SVG with `uqr` 0.1.3 (MIT, zero dependencies, unjs; a new dependency, so it needs the human's yes at the gate), so no QR code reaches the browser bundle
  - a download as SVG, and a "Show at the counter" full-screen view (large QR, amount, merchant name, the test-mode strip)
  - invoices get the same QR on their pay link
- [ ] **Hosted `/l/[slug]`:** the static night scene and a sheet (merchant name, description, amount + currency, or an amount input for open links), and a plain HTML form POST to the public checkout route, 303 to the checkout (a full load, so the checkout's CSP applies). Closed, expired, paid and not-found states.
- [ ] **Hosted `/p/[slug]`:** the merchant's logo and colour, used as an accent only and never for text contrast. Fixed items with quantity steppers (no JS needed: number inputs) or an open amount, a total shown server-side, and a form POST → 303.
- [ ] Both hosted pages get the **strict CSP** (next.config.ts), make no browser chain reads, have no crypto words, and fit NFR-12.
- [ ] **`/merchant/payments`:** a full payments list (from GET /api/v1/payments, our route) with a refund per row (the existing Refund component), receipts and explorer links. The Nav "Payments" item points here.
- [ ] **Design:** the approved gateway v2 language (design-refs/gateway-v2-demo.html), meaning editorial headers with mono section labels, objects as cards, `linear()` springs, and halftone accents.
- [ ] Tests (RED first): the gateway client (shapes, errors → plain copy, snake_case parsing); the QR SVG renders and decodes back to the URL (decode with a tiny test-only check, or compare to a known vector); the link/page form validation; the hosted pages' states (render-level where possible); the public form → 303 (with fetch mocked).
- [ ] typecheck, lint, `npm test` 0 fail, build; screenshots at true 375 and 1440, light and dark; the FR-PAY-7 scan of /l and /p; NFR-12 for /l and /p.

- [ ] **Relayer auth** (claude-relayer 05:49): when their batch 006 lands, `lib/relay.ts` sends `x-relay-secret: process.env.RELAY_API_SECRET` (server-only, from the root .env; never logged). The tests assert the header is sent and the secret never appears in an error.

## Files (claude-frontend)
- **New:** `apps/web/app/merchant/{links,pages,payments}/page.tsx`, `apps/web/app/l/[slug]/page.tsx`, `apps/web/app/p/[slug]/page.tsx`, `apps/web/components/gateway/*`, `apps/web/lib/{gateway-client,qr}.ts`, tests.
- **Edited:** `apps/web/components/dashboard/Nav.tsx`, `apps/web/next.config.ts`, `apps/web/components/InvoicePay.tsx` / `app/merchant` (the invoice QR).
- **`apps/web/package.json` + lock: wait for claude-contracts' DONE** (their batch 007 PR claims them). Add `uqr` after their PR merges, or ask them to add it with theirs.

## Out of scope
- Vouchers, reports, settlements, API keys, webhooks (batch 008).
- The landing page (its own batch, waiting on the human's animation notes).
- The FX switch to claude-contracts' module (after their PR).

## Human decisions (06:30)
- `uqr@0.1.3`, exact pin: **approved**. Add it on top of main's package.json; never copy the scratch package.json.
- `img-src https:` on `/p/:path*` and `/merchant/pages` (the merchant's logo): **approved**. Scripts and connections stay `'self'`.

## Merge notes (builder b011, 06:28)
- Drop the builder's `lib/relay.ts` edit and `test/relay-secret.test.mjs`; batch 008 already has the header and `test/relay-auth.test.mjs`.
- Existing-file edits to apply by hand (b011-existing-edits.diff): Nav.tsx (3 links), next.config.ts (logoCsp, /l, /p, /counter, /merchant/:path*), Invoices.tsx (QrActions).
- Follow-up: the merchant home's "Create a payment link · Soon" action should link to /merchant/links.
- ponytail: our server calls the gateway routes over HTTP, so on Vercel the rate limit sees one IP. Switch to direct lib/server calls.
