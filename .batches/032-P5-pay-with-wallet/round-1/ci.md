VERDICT: PASS
# ci: 032-P5-pay-with-wallet, round 1 (phase mode, PIPELINE.md §3b)

Run by the builder in its worktree on branch p5-pay-with-wallet, after merging origin/main (65258b4). Node 26.10.0.

## apps/web: npm run typecheck
```
> web@0.1.0 typecheck
> next typegen && tsc --noEmit

Generating route types...
✓ Types generated successfully
exit 0
```

## apps/web: npm run lint
```
> web@0.1.0 lint
> eslint

exit 0
```

## apps/web: npm test
```
ℹ tests 600
ℹ suites 0
ℹ pass 598
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 63872.038292
exit 0
```
New: test/payer-wallet.test.mjs (8 tests: AT-17 one eth_signTypedData_v4 and no transaction, the pay route relays the
wallet's approval; the wallet's typed data equals the guest's for the same checkout, salt and time; the invoice's
owed + fee; switch to 1874; add Whitechain Testnet with the onboarding's parameters on 4902; a wallet that stays on
another chain is refused before any prompt; cancel / request open / refused network / no wallet / no account copy).
test/funds.test.mjs (6 tests: {enough} only, at exactly the amount and below it; the amount due after a held code;
400 / 404 / 503; per-IP rate limit 30/min; invoice owed + fee; another shop's invoice 404).
The 2 skipped are the existing live-chain tests (onchain.live.test.mjs), skipped without their env, as on main.

## apps/web: npm run build
```
✓ Compiled successfully in 5.1s
  Finished TypeScript in 15.6s ...
✓ Generating static pages using 14 workers (41/41) in 576ms
├ ƒ /api/v1/invoices/[id]/funds
├ ƒ /api/v1/sessions/[id]/funds
exit 0
```
(The "gateway api error: Error" lines during "Collecting page data" are the build running without a database, as on
main; they are logs, not failures.)

## CSP and secrets
- `git diff origin/main...HEAD -- apps/web/next.config.ts` is empty: the pay-page CSP is unchanged (an injected wallet
  needs no host; connect-src 'self' covers the funds routes).
- `git diff origin/main...HEAD` added lines grepped for 64-hex keys, sk_live, PRIVATE_KEY, mnemonic: no match.

## Not run here
- The browser walk (probes/wallet-walk.mjs): the pay pages need the database at run time, and copying the env file
  into this worktree was refused (correctly) by the permission system. Run it against the PR's preview, or locally from
  a checkout that has its env: `BASE=<url> SLUG=<link slug> node probes/wallet-walk.mjs out.json`.
