VERDICT: PASS

# CI, batch 021-P4-web-voucher-speed (phase mode, Money: yes; run by claude-frontend at 10:25)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 461, pass 459, fail 0, skipped 2. voucher-pay is 24/24, including 7 new. |
| Build | `npm run build` | exit 0 |
| Live :3100 | restart (RESTART/UP posted) | / gives 200 |

## Builder evidence (scratch b020)
- RED first: 4 of the 7 new tests failed on the old code; 2 new-branch mutants were killed.
- NFR-12: /checkout is 186,351 B (+16 B).
- **Real browser:**
  - Apply a code, then hold: the only requests are POST /voucher and POST /pay {amount}, with no GET before the pay.
  - A total changed from another tab gives a 409 with the new total; the sheet updates, and the next hold sends the new amount.
- **Timing model** (PGlite, 40 ms per database trip): 1,562 ms before vs 1,433 ms after per discounted pay.

**Not measured:** the real Neon and Vercel click-to-confirm. That waits on the next live voucher sale, warmed by batch 020's relayer ping.

## After the security pass (PASS; 1 LOW, 4 INFO)
- **F1 LOW, fixed:** the overlap test now requires this session's checkout read (the query values are recorded), so a background read from an earlier test can't satisfy it.
- **F3 INFO, fixed:** the docs say the 409 applies to link and page checkouts only, and that a malformed `amount` gets a 400.
- **F5 INFO, fixed:** the comments say batch 021.
- **F2 and F4 INFO:** no change. Client mutants can't move money, and the 409 adds no new exposure.
- Re-run: typecheck 0, lint 0, `npm test` 461 tests (459 pass, 2 skipped).

