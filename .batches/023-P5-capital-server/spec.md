# Spec: 023-P5-capital-server (phase mode, Money: yes)

## Requirements
FR-ADV-1, FR-ADV-3, FR-ADV-6, FR-INV-2, FR-ARK-1, FR-ARK-2, FR-ARK-3, FR-ARK-4, FR-ARK-5, FR-TOK-8. The server half of AT-3 to AT-9 through the Capital tab; claude-frontend builds the screens.

## API (claude-contracts 08:53, exact; snake_case; amounts are plain USDT strings via plainUsdt)
- `GET /api/v1/capital/offers` (public): `{offers:[{id, kind, merchant, merchant_name, principal|face, price, cap, holdback_pct, maturity, offer_deadline, units_left, status, arkiv:{entity_key, matches}}]}`.
  - Chain `offers(1..offerCount)` joined with the Arkiv `mcplus.offer.v1` entities.
  - Cancelled and expired-unfunded offers are left out (AT-9).
  - `status`: settled → `closed`, sold = face → `funded`, otherwise `open`.
  - `matches` = every Arkiv term equals the chain (FR-ARK-3). The UI disables Buy when it is false.
  - Advances carry `principal`, `cap` and `holdback_pct`; invoices carry `face`; any field that doesn't apply is null.
- `POST /api/v1/capital/offers/{id}/publish` (dashboard cookie, that offer's merchant only) → `{entity_key}`: creates or patches the Arkiv entity from the chain (FR-ARK-1/4/5). The entity expires at the offer deadline.
- `GET /api/v1/capital/quote?claim=&units=` → `{cost}` (`CapitalMarket.quote`, FR-ADV-6: the total shown before signing).
- `GET /api/v1/capital/transfer-check?from=&to=&claim=&amount=` → `{allowed, reason|null}`. The checks run in ClaimToken's own order (`_checkTransfer`, then ERC-1155's balance check, then the holder cap):
  1. the claim isn't frozen;
  2. it's before `lockFrom`;
  3. the sender is eligible;
  4. the receiver is eligible;
  5. the amount fits the unfrozen units;
  6. the amount fits the balance;
  7. the holder cap (8).
- `GET /api/v1/capital/merchant` (cookie) → `{advance:{claim_id, outstanding, cap, holdback_pct}|null, offers:[…]}`, where `offers` is the merchant's live offers (FR-ARK-2).
- `POST /api/v1/capital/fund {claim_id, investor, units, valid_after, valid_before, salt, sig}` → `{tx_hash, block_number}` through the relayer's fund action (FR-ADV-3). The investor signs ReceiveWithAuthorization to CapitalMarket with value = quote and nonce = fundingNonce. `valid_after` must be "0" (lib/relay.ts sends 0). Errors are plain messages.

## Design
- `lib/server/capital.ts`: CapitalMarket and ClaimToken reads with an injectable `read` (the lib/onchain.ts pattern), using `parseAbi` fragments pinned against `packages/shared/contracts.ts` by a test. Also the offer JSON, status, quote and transfer-check.
- `lib/server/capital-arkiv.ts`: the `mcplus.offer.v1` schema (names from ARCHITECTURE §5), query, `matches`, publish. An Arkiv failure never hides the book: the offer shows `arkiv:{entity_key:null, matches:false}`.
- Public GETs are rate-limited per IP (rateLimit in http.ts).
- **Open for the build pack (docs/CAPITAL-TAB.md) and claude-contracts:**
  - §5's `terms` bytes (the merchant's EIP-712 signature) can't be made server-side. publish writes the chain terms plus the debtor hash.
  - `aprBps` is derived from the chain: (face − price)/price, annualised over maturity − deadline.
  - `sector` is "general".

## Acceptance criteria
- [ ] Tests first: `test/capital-*.test.mjs` cover offer JSON and status (incl. AT-9 filtering), `matches`, quote, the transfer-check order (each reason), the merchant view, fund body validation, the ABI pin, and auth (publish 401 without a cookie, 403 for another merchant's offer).
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run build` in apps/web pass.
- [ ] Live reads against the real CapitalMarket: offers, quote, transfer-check (no transactions).
- [ ] claude-contracts reviews the PR for the API shape.

## Files to touch
apps/web/lib/server/capital.ts, apps/web/lib/server/capital-arkiv.ts, apps/web/app/api/v1/capital/** (offers/route.ts, offers/[id]/publish/route.ts, quote/route.ts, transfer-check/route.ts, merchant/route.ts, fund/route.ts), apps/web/test/capital-*.test.mjs.
