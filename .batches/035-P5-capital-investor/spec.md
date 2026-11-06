# Spec: Capital tab, investor view (/capital) (phase mode, Money: yes)

Build pack: docs/CAPITAL-TAB.md §2.1 (what the investor signs), §3 (server API, merged in batches 023 and 026), §4 I0-I4, §6 click paths.
The server routes under apps/web/app/api/v1/capital/** are not changed by this batch.

## Requirements
- **FR-ADV-3 / FR-INV-3:** an eligible investor funds an advance or part of an invoice by signing one EIP-3009
  `ReceiveWithAuthorization` (domain Tether USD v1, chain 1874, verifyingContract USDT; to = CapitalMarket;
  value = `GET /api/v1/capital/quote`; validAfter 0; validBefore now + 465 s; nonce = `fundingNonce(claimId, investor, units, salt)`).
  The browser posts `{claim_id, investor, units, valid_after: "0", valid_before, salt, sig}` to `POST /api/v1/capital/fund`. No gas (CON-4).
  The total cost shows before signing; the investor types only the amount it gets back (units).
- **Holder caps (batch 026):** an advance takes 1 investor, an invoice 2. A new investor taking the last free slot must buy all units left:
  the panel pre-fills them, locks the field and says why. A full claim blocks a new investor.
- **FR-TOK-2 / FR-TOK-7:** a wallet that isn't eligible (ClaimToken.canReceive) sees the book read-only, with
  "waiting for approval" copy; it keeps seeing its holdings.
- **FR-ARK-2 / FR-ARK-3:** the offer book comes from `GET /api/v1/capital/offers` (Arkiv joined with the chain).
  Buy is enabled only when `arkiv.matches` is true and the chain status is open; otherwise it is disabled with the reason.
- **FR-TOK-3 / FR-TOK-4 / FR-TOK-8:** holdings (I3) read the investor's claims in the browser; the transfer check (I4) calls
  `GET /api/v1/capital/transfer-check` and shows the reason first (not eligible, frozen, locked, holder cap). No Send button (AT-8).
- Every screen has loading, empty, error, not connected and wrong network states; 375 px and 1440 px layouts.

## Acceptance criteria
- [ ] AT-3: an investor can fund all 11 units of a 10 USDT advance from /capital (cost 10.00 USDT shown before signing).
- [ ] AT-6: investor A buys 60 of a 100 USDT invoice; investor B (the last slot) gets 40 pre-filled.
- [ ] AT-8: the transfer check shows the receiver-not-eligible reason before any send; no Send button.
- [ ] AT-9: /capital lists the open offers with their Arkiv entity key; expired offers aren't listed (server); the meter counts the browser's reads.
- [ ] Tests first: test/ui-capital-investor.test.mjs signs with lib/capital-wallet.ts's typed data and the server's
      fundOffer accepts it; fundingNonce matches the chain vector; last-slot pre-fill and fund blockers.
- [ ] apps/web: npm run typecheck, npm run lint, npm test, npm run build pass.

## Files
apps/web/lib/capital-wallet.ts (new), apps/web/app/capital/** (new), apps/web/components/capital/investor/** (new),
apps/web/test/ui-capital-investor.test.mjs (new).

## Not in this batch
next.config.ts (no CSP rule for /capital exists; adding one is outside these paths), the Nav, the merchant view.
