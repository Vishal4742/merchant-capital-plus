# 035-P5-capital-investor · round 1 · ci

Branch `p5-capital-investor` at the merge of origin/main `a6bc609`. Run from `apps/web` on 2026-11-06.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | `✓ Types generated successfully`, `tsc --noEmit` exit 0 |
| Lint | `npm run lint` | `eslint` exit 0, no warnings |
| Tests | `npm test` | `tests 598 · pass 596 · fail 0 · skipped 2` (the 2 skips are the existing live-chain tests) |
| New tests | `node --test test/ui-capital-investor.test.mjs` | 12 / 12 pass (failing first at `9b37391`: module missing) |
| Build | `npm run build` | exit 0; `✓ Compiled successfully`; `/capital` and `/capital/holdings` prerender as static (`○`). The `gateway api error` lines are other pages' prerender without a database, as on main. |

New tests (test/ui-capital-investor.test.mjs):
- addresses and ABI fragments pinned to packages/shared; HOLDER_CAP and its message equal the server's
- `fundingNonce(2, A, 60000000, 0x00…01)` = the chain vector `0x91151ff3…1878`, and equals the server's
- the typed data is ReceiveWithAuthorization on USDT (Tether USD v1, 1874), to CapitalMarket, validAfter 0, value = the quote
- a signature over the browser's typed data passes `fundOffer` and is relayed once (AT-6: A 60 at 58.839334, then B 40 at 39.226223 as the last slot); a signature over another value is refused before the relayer
- `slotRule` (last slot buys everything left, full claim blocks, existing holders add), `minUnits` (1019726, 1099999), `buyBlocker`, `amountBlocker`, `fundOutcome` (5xx and hashless 200 are unknown), `claimsToShow`, `aprPercent` (12.0% over 60 days)

Screens (dev server, fake injected wallet and mocked capital API answers, no real signature; Playwright at 375 and 1440, no horizontal overflow on any): live book disconnected (2 closed chain offers, Arkiv not configured locally), mocked book disconnected, wrong network, not eligible, fund an invoice as the last slot (40.00 pre-filled, total 39.226223), fund the advance (11.00, total 10.00), holdings with a blocked transfer check, holdings disconnected.

VERDICT: PASS
