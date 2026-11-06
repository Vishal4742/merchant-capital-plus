VERDICT: PASS

## Re-run after the security follow-ups (f968a73: M1, M2, M3, L1, L2)
- `npm run typecheck`: "✓ Types generated successfully", tsc exit 0
- `npm run lint`: exit 0, no output
- `npm test`: tests 600, pass 598, fail 0, skipped 2 (the two live-chain tests below); test/withdraw.test.mjs 14/14
  (new: "Check again after an unconfirmed send…" and "a transfer whose dry run returns false is refused…")
- `npm run build`: exit 0, "✓ Compiled successfully", "Generating static pages using 14 workers (41/41)", /merchant/settlements ◐
- GitHub Actions on c9744d8 (PR #30): web pass (3m24s), changes pass, secrets pass; contracts/mcp/relayer/sdk skipped (unchanged)

## First run
Phase mode (PIPELINE.md §3b.1): the lane ran the checks itself in apps/web on branch p5-settlement-withdraw at d4e75f5
(origin/main 1f92783, branch 0 commits behind). Real output below.

## npm run typecheck
```
> web@0.1.0 typecheck
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
```
exit 0, no errors.

## npm run lint
```
> web@0.1.0 lint
> eslint
```
exit 0, no warnings or errors.

## npm test (all of apps/web/test)
```
ℹ tests 598
ℹ suites 0
ℹ pass 596
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 30407.47925
```
exit 0. The 2 skipped are existing live-chain tests ("the smoke sale settles…", "the final MerchantPay 0xab81…4251…"),
skipped without their env; neither touches this batch.

New file test/withdraw.test.mjs, 12/12 pass:
```
✔ the copied contract addresses match packages/shared/contracts.ts
✔ a destination is accepted checksummed or all lower case, and comes back checksummed
✔ each refused destination has its own plain reason
✔ amounts are bigint base units, never floats
✔ Max fills the exact balance, down to the last base unit
✔ each refused amount has its own plain reason
✔ the balance read is USDT.balanceOf(merchant) on chain, as an exact bigint, retried on a flaky read
✔ AT-18: withdrawing 1 USDT sends exactly one transfer of 1_000_000 units to that address, from the merchant's wallet
✔ the network fee estimate covers the transfer itself, and too little WBT for it stops before the wallet asks
✔ more than the wallet holds now is refused by the dry run, before anything is sent
✔ plain errors: rejected in the wallet, no WBT for gas, wrong network
✔ sent but unconfirmed keeps the tx hash for its link, so the merchant checks before sending again
ℹ tests 12  ℹ pass 12  ℹ fail 0
```
RED first: commit c9c5512 (tests only) failed at import; GREEN at 5b4bbb6.

## npm run build
```
▲ Next.js 16.4.3 (Turbopack)
✓ Compiled successfully in 5.5s
  Finished TypeScript in 3.5s ...
  Generating static pages using 14 workers (41/41)
├ ◐ /merchant/settlements
```
exit 0. The "gateway api error: Error" / "shop key check: Error" lines during prerender come from existing routes with no
database env at build time; none of this batch's files log them.

## Fee estimate probe (read-only, no transaction)
`estimateContractTotalFee` (viem/op-stack) for a USDT transfer from 0x37F9…42B1 on chain 1874 via Ankr:
gas 61507, gas price 5001000000, L1 fee 3300 wei, total 307596507003300 wei (about 0.000308 WBT). The operator-fee
read works on this chain, so the estimate includes L2 gas, L1 data fee and operator fee.

## Page check (local `next start`, dummy AUTH_SECRET, test session for 0x37F9…42B1)
- GET /merchant/settlements → 200; "USDT in your wallet: 70.71", which matches USDT.balanceOf on chain (70710000).
- Typing the USDT contract address and 100 → "That's our USDT contract, not a wallet…" and "That's more than the 70.71 USDT
  in your wallet." No wallet prompt on a refused form. Screenshots: 1440 wide only (the Chrome window would not go below
  about 1500 px, and the merchant CSP blocks an iframe preview); 375 not captured.
- No transaction was sent.
