VERDICT: PASS

# CI, batch 011-P4-web-network-fee (phase mode, run by claude-frontend at 07:45)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 334, pass 331, fail 0, skipped 3 (live FX only). New: onchain-fee (gas × price + L1 fee; retry, then the error), formatWbt (6 dp, half up, no exponent, "<0.000001"), receiptId on session and log rows. |
| Build | `npm run build` | exit 0 |
| Live chain | `readTxFee` on today's payments (Ankr) | AT-1 tx 0x7e03…7a11: 1,040,122,983,005,341 wei = 0.00104 WBT. NFR-4 tx 0xd1a7…987a: 1,063,907,739,004,715 wei = 0.001064 WBT. |
| Live :3100 | curl after restart | / and /merchant/payments give 200 |

**Not shown in a browser:** the signed-in /merchant/payments screen needs the demo merchant's wallet in the human's browser (signed out, the page shows the sign-in card).
