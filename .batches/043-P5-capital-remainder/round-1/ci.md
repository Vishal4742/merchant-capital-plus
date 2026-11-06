# 043-P5-capital-remainder · round 1 · ci

Branch `p5-capital-remainder`, after merging origin/main `35dde9e`. Run from `apps/web` on 2026-11-06.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 (`✓ Types generated successfully`, `tsc --noEmit` clean) |
| Lint | `npm run lint` | exit 0, no warnings |
| Tests | `npm test` | exit 0: `tests 669 · pass 667 · fail 0 · skipped 2` (the existing live-chain skips) |
| Build | `npm run build` | exit 0: `✓ Compiled successfully`, 44/44 static pages; `/capital` and `/capital/holdings` static |

Tests first (`004798e`, red: 4 failing), then green:
- `test/capital-fund.test.mjs`: on the AT-6 invoice (100.00 at 98.065556), a 99.50 first buy is refused with 400
  "Buy all 100.00 USDT, or leave at least 1.019726 USDT for the next investor." and nothing is relayed; 1019725 left is
  refused, exactly 1019726 left is relayed; AT-6's 60 (leaves 40) and a full 100 are relayed; an advance holder's top-up
  that leaves 0.50 is refused.
- `test/ui-capital-investor.test.mjs`: `amountBlocker` gives "Buy all 100.00 USDT, or leave at least 1.02 USDT for the
  next investor." with the same boundary and AT-6's 60 passes; `usdt2` (98.07, 58.84, 39.23, a minimum rounds up to 1.02);
  `fundHint` tells an invoice's first investor that the second buys everything left; `investorsLabel`.

Screens (dev server, fake wallet, mocked API, nothing signed; 375 and 1440, no horizontal overflow): an invoice's first
slot typing 99.5 shows the remainder rule and no button; typing 60 shows "Total cost: about 58.84 USDT" with the exact
58.839334 only on "Hold to pay" and its sign line; rows show "1 investor" / "Up to 2 investors"; prices show 98.07.
Tab order at 375: Merchant Capital+ → Offers → Your claims (row 1) → the wallet chip (row 2), matching the layout.

Follow-up (claude-frontend's pre-deploy smoke walk), `1ec73af` plus the merge of origin/main `c24aaf3`: a closed offer with
no entity now reads "Closed · Arkiv entry expired", and an open offer without one keeps "Not on Arkiv" (`arkivNote`, both
cases tested, red first). Re-run: typecheck exit 0, lint exit 0, `npm test` 675 tests (673 pass, 0 fail, 2 skipped), build exit 0 (44/44).

VERDICT: PASS
