VERDICT: PASS

Phase mode (PIPELINE.md §3b.1): the lane ran the checks in apps/web on branch p5-withdraw-followup (from origin/main
25ac4e1). Real output below.

## Tests first
- dd0a635 (tests only), `node --test test/withdraw.test.mjs`: tests 17, pass 14, fail 3. The three new tests failed:
  "the hash is handed out as soon as the wallet sends, before any receipt is read", "onSent carries the hash of an
  unconfirmed send, and isn't called when nothing was sent", "the wrong-network copy names the network the way the app does".
- 5c1c91b (lib/withdraw.ts: `onSent`, "Whitechain Testnet (chain 1874)"): tests 17, pass 17, fail 0.

## npm run typecheck
```
Generating route types...
✓ Types generated successfully
```
exit 0.

## npm run lint
```
> web@0.1.0 lint
> eslint
```
exit 0, no output.

## npm test (all of apps/web/test, at ddbc938)
```
ℹ tests 632
ℹ pass 630
ℹ fail 0
ℹ skipped 2
```
exit 0. The 2 skipped are the existing live-chain tests (skipped without their env).
After the 041 → 042 rename, which touched only comments and test names: test/withdraw.test.mjs ran 17/17, and the
pre-push hook re-ran typecheck, lint and tests.

## npm run build
```
✓ Compiled successfully in 1322ms
✓ Generating static pages using 14 workers (43/43) in 258ms
├ ◐ /merchant/settlements
```
exit 0.

## Security MEDIUM (review of #35): a replaced withdraw shown as Sent
- 1510f1b (tests only): test/withdraw.test.mjs tests 21, pass 17, fail 4. The failures were a cancelled replacement, a
  replaced one, a repriced one (link the new hash; refuse a wrong amount or another token's log), and a success receipt
  without USDT's Transfer log.
- 862b9d9 (lib/withdraw.ts: onReplaced; cancelled → CANCELLED, replaced → REPLACED, repriced → the new hash; Sent requires
  Transfer(merchant → to, amount) from USDT): 21/21.
- typecheck exit 0 ("✓ Types generated successfully"); lint exit 0; npm test: tests 654, pass 652, fail 0, skipped 2;
  build exit 0 ("✓ Compiled successfully", 44/44 pages).

## Not run here
- A real send on testnet (AT-18, human). No transaction was sent; the wallet is a fake EIP-1193 provider in the tests.
