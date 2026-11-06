VERDICT: PASS

# CI, batch 019-P4-web-g4-ux-blockers (phase mode, Money: no; run by claude-frontend at 09:53)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, 0 warnings. The dead pageTotal/previewTotal uses and an unused import were removed. |
| Unit tests | `npm test` | exit 0: tests 452, pass 450, fail 0, skipped 2. New: liveTotal (price × qty; 0, blank, fractional, negative and >100 count as 0). |
| Build | `npm run build` | exit 0 |

## Browser (Playwright, 375×812 mobile, real :3100 against the reviewer's page /p/egAwjNvIhu)
- **M1:**
  - At 0 items, "Continue to pay" is disabled and the hint "Choose at least one item." shows.
  - Typing a quantity of 2 makes the total read 12.00 and enables the button, with no reload.
  - Shots: p-zero-375.png, p-two-375.png.
- **H2:**
  - The checkout sheet's right edge is 359 (= 375 − 16) with the code field open, and still 359 with an error shown.
  - `scrollWidth <= innerWidth`.
  - Cause: the code input's built-in ~20-character width set the sheet's minimum width. Fix: `w-0 flex-1`, plus `min-w-0` on the form and `<details>`.
  - Shots: checkout-codeopen-375.png, checkout-badcode-375.png.
- All shots are in scratchpad/b019x-shots/.

**Env (claude-contracts 09:24):** VOUCHER_HASH_SECRET and the ARKIV_* lines were copied from the root .env into the web env (values never printed), so vouchers mirror to Arkiv on :3100.
