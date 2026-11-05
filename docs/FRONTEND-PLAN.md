# Frontend plan: Merchant Capital+ (claude-frontend)

This is planning only; Start Fresh means no product code before Thu 21:00 IST. After 21:00, every change is a batch (PIPELINE.md) that cites `docs/SRS.md` IDs. If this file disagrees with the SRS, ARCHITECTURE.md or PHASES.md, those win. Lane: `apps/web/`, `apps/shop/`.

## Stack

Pinned on 2026-11-05 to releases that are about a week old or more. Install with `--save-exact` and commit the lockfile.

| Package | Pin | Released | Why |
|---|---|---|---|
| next | 16.4.3 | Oct 23 | App Router, API routes for sessions, webhooks, CSV and the Arkiv writer |
| react, react-dom | 19.2.9 | Oct 14 | |
| viem | 2.57.13 | Oct 28 | ships `whitechainSepolia` (1874) in `viem/chains`, verified in the package source |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | Jul 16 | |
| @anon-rpc/browser-harness | 0.4.0 | Oct 28 | FR-PRIV-1; read its README and spec-types before writing calls |
| @arkiv-network/sdk | 1.0.1 | Nov 2 | ARCHITECTURE §5 pin. 1.0 removed payloads and `buildQuery`, so read the source |
| @privy-io/react-auth | 3.51.0 | Oct 21 | only if DEP-3 passes in Phase 1; otherwise use the guest wallet |

No wagmi and no react-query. Every signature is typed data, and viem does that alone: `custom(window.ethereum)` for merchant, investor and compliance; Privy's provider or a local key for the customer.

## Screens by phase (each line is one batch)

**P1 Rail proofs (G1)**
- Skeleton passes tsc, lint and build. `lib/anon.ts` reads `eth_blockNumber` from Ankr through Nym in the browser (DEP-6).
- Privy against DEP-3: signs typed data on 1874, loads no third-party trackers (check the network tab), and takes about an hour to integrate. Any failure means the guest wallet, stated in the README limitations.
- One Arkiv create and query (DEP-5).

**P2 Payments core (G2: AT-1, AT-2)**
- Customer: `/pay/[invoiceId]` and `/checkout/[sessionId]`, each with one "Confirm payment" button (FR-PAY-3, 5, 7). **No browser chain reads on these two pages** (FR-PRIV-1, SRS 1.1): amount and merchant come from our server, and that server read is a disclosed exclusion (FR-PRIV-4). Receipt `/r/[paymentId]` with refund status and an explorer link (FR-PAY-9).
- `/merchant`:
  - create and cancel invoices (FR-PAY-1, 2)
  - payments table with gross / fee / to investors / to merchant columns
  - one-click refund (FR-PAY-8)
  - relayer `/health` card (FR-REL-6)
  - shop API keys
- `POST /api/v1/sessions` (FR-PAY-4).
- `apps/shop`: café store with a ≈20-line integration whose lines the README counts (FR-PAY-11).

**P3 Advance (G3: AT-3, AT-4, AT-5)**
- `/merchant` "Cash advance": principal, cap, holdback and term, with the total cost shown before signing (FR-ADV-1, 6). Show the live lien and amount outstanding.
- `/invest`: fund an advance with one signature (FR-ADV-3); portfolio of claims and payouts.
- `/compliance`: add or remove eligible investors from the owner list (FR-KYC-1).

**P4 Invoice financing, Arkiv, private reads (G4: AT-6 to AT-9)**
- `/merchant` "Get paid today": an APR slider showing the price (FR-INV-1, 2), plus "my live offers" from Arkiv.
- `/invest` offer book from Arkiv. Each offer is checked against `CapitalMarket.offers`, and Buy stays disabled on a mismatch (FR-ARK-1–5). Transfer preview showing the `canTransfer` reason before the user tries (FR-TOK-8, now M in P4, needed for AT-8).
- Anon-RPC on by default everywhere, with the "Private reads · N%" meter (FR-PRIV-1–3).
- CSV export (FR-PAY-12) and HMAC webhooks (FR-PAY-10).

**P5 Extras:** acknowledge and pay-on-due-date screens (FR-PAY-13, 14); EAS desk (FR-KYC-2, 3); merchant stats (FR-ARK-6).

## Rules for every screen
- One batched Multicall read per screen through `lib/anon.ts`, with no log scans (NFR-5). History comes from Blockscout `/api/v2/...`, listed as an exclusion (FR-PRIV-4). The tokens transfers endpoint works on the testnet explorer, checked at 18:35.
- The customer never sees "sign", "gas", "WBT" or "Whitechain" (FR-PAY-7, NFR-6).
- No trackers or analytics in the client (NFR-8). Check Privy's network calls before keeping it.
- No landing page: no SRS item asks for one.
- No faucet or "get test USDT" button anywhere (CON-8). Demo wallets are funded by claude-contracts' seed script.
- Design: the v7 lock in HANDOFF.md, to confirm with the human in Phase 2. Rebuild it from `design-refs/`; copy nothing.

## Decisions (human, SRS 1.1, 19:50)
- FR-TOK-8 moved to P4 as M, so AT-8 holds at G4.
- Demo funding: seed script (CON-8), no button in the app.
- /pay and /checkout make no browser chain reads (FR-PRIV-1, FR-PRIV-4).
- Privy: tested against DEP-3 in P1, guest wallet on any failure.
- Batch size: one batch per bullet above.

## Demo amounts (human, SRS §6, 19:55)
Amounts were divided by 10: a 100 USDT advance (cap 110, 20% holdback), a 1,000 USDT invoice at 12% APR over 60 days split 600/400, and a 25 USDT sale. If the team can't collect about 1,100 test USDT by Phase 2, they drop by another 10.
- **No amounts in UI code.** They come from the seed script and the chain.
- **Investor cost comes from `CapitalMarket.quote(claimId, units)`**, shown with `formatUnits(x, 6)`, never from our own math or rounding. The contract rounds up (`ceil`), so client math can be off by 0.000001. For example, at 12% over 60 days the full invoice prices at about 980.655562, which is 588.393337 + 392.262225.
- The APR slider (FR-INV-2) may compute a suggested price in the browser. Show it as an estimate until `quote` returns.

## P1 prep: read from the package source (20:15, before the start)
- **Anon-RPC 0.4.0:** `new AnonRpcWorker({ address, config?, preExisting: { rpcProvider } })`, then `worker.fetch(url, init)`. `rpcProvider` only needs `request({ method, params })`, and a viem mainnet `createPublicClient` already has that. It makes 2 `eth_call`s to the specifier on **mainnet**, the disclosed bootstrap read (FR-PRIV-4). viem's default mainnet RPC is `https://ethereum.reth.rs/rpc`. The iframe uses `srcdoc` with inline script, so if we add a CSP without `'unsafe-inline'` we must serve `dist/iframe-boot.js` same-origin and pass `iframeUrl`, or `ready` never settles. Browser-only, so `lib/anon.ts` runs client-side (`"use client"`, dynamic import). Check the Nym worker's expected `config` against the demo at https://ethereum.github.io/anon-rpc/demo/.
- **Arkiv 1.0.1:**
  - Schema with `defineSchema("mcplus.offer.v1", { … .indexed() })`.
  - Writes: `walletClient.createEntity(schema, values, { expiration: ExpirationTime.atDate(deadline) })` and `patchEntity` for status (FR-ARK-5).
  - Reads: `publicClient.select({...}).from(schema).where(and(eq(...)))`, then `.ownedBy(PUBLISHER).fetch()`. Anyone can write under any schema, so always filter `ownedBy` our publisher.
  - `rabdi({ accessKey })` puts the key in the RPC URL. The SDK calls it "not a secret", meant to ship in the app and restricted to your origins, so browser reads may use it. The **writer private key** stays server-only (NFR-3).
  - Clients are viem-based, so reads can take the Anon-RPC `custom` transport (FR-PRIV-2).
- **Privy 3.51.0 (DEP-3 pre-check):** the bundle (8.6 MB) contains a `/api/v1/analytics_events` endpoint on `auth.privy.io`. WalletConnect telemetry is off. If the network tab shows `analytics_events` firing, Privy fails "no third-party trackers" and we use the guest wallet. Confirm in P1 rather than assume.
