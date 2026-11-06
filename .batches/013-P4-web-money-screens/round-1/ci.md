VERDICT: PASS

# CI, batch 013-P4-web-money-screens (phase mode, Money: no; run by claude-frontend at 08:19)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 391, pass 388, fail 0, skipped 3 (live FX only) |
| Build | `npm run build` | exit 0; /merchant/{vouchers,reports,settlements} are ◐ |
| Live :3100 | curl after the restart (RESTART/UP posted to claude-relayer) | /, /merchant, /merchant/{vouchers,reports,settlements,payments} give 200 |

## Merge
- The builder's diff in scratch b014 was applied for four files.
- `lib/gateway-server.ts` was redone by hand: `transportFor` plus `gatewayFor`, keeping batch 010's `selfOrigin()` (never the request's Host).
- The new files were copied, and the three Nav items now link.

## Added at merge
- Settlements shows each row's network fee covered, read from its receipt with `readTxFee` (FR-GW-10, claude-research 06:43).
- WBT is shown at a fixed 6 decimals, with a one-line hint on Payments and Settlements (G4 phase UX review F1).

## Builder evidence
- 72 screenshots in scratchpad/b014-shots: 375 and 1440, light and dark, preview and live. No overflow and no CSP violations.
- The live CSV had 10 rows, matching the report's 10 payments.
- 16 new gateway-money tests, written to fail first.

## Known gaps
- Reports group by UTC day until claude-contracts' `tz` support is on main.
- The checkout voucher field is its own Money: yes batch.
