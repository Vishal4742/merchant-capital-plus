VERDICT: PASS

# CI, batch 015-P4-web-voucher-pay (phase mode, Money: yes; run by claude-frontend at 08:50)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 396, pass 394, fail 0, skipped 2. The fx tests were deleted with lib/fx.ts; voucher-pay adds 17 on PGlite. |
| Build | `npm run build` (08:37) | exit 0 |
| Live :3100 | restarted 08:38 (RESTART/UP posted) | `/` gives 200. claude-research verified AT-12's payment half on chain at 08:38 (0xb3e71540…0e81, 9.90 split exactly). |

## F1–F3 tests (builder, scratch b015)
- **The named F1 test:** apply A → claim → 422 with the order paid on chain → no release → apply B refused → confirm counts A.
- **Releases:** on a bad signature, insufficient funds, BUSY, another 4xx, or a 422 once findPayment returns exactly null. **No release:** on unknown, an unconfirmed 200, or a failed chain read.
- **settlePending:** "open" releases; "paid" records with the claimed price.
- **F5:** applying a code during an in-flight or pending payment gives 409.
- **Mutants:** 12 pay-route mutants, all killed.

## Late change (08:47, claude-contracts 08:39)
claimAmountDue's thrown 410 (a single-use link already paid elsewhere) is shown as-is, with no release; any other claim failure releases. The voucher-pay tests (17) still pass; the 410 can only be exercised live once claude-contracts' batch 015 is on main.

## NFR
- **NFR-12:** /checkout with the code field is 186,326 B of JS (builder).
- **NFR-4:** 5.82 s click-to-confirm on the voucher checkout (G4 runner, local relayer), over the 5 s target. The extra round trips (the pre-sign GET of the amount due, then checkoutOf + claim) are tracked for the next batch.
