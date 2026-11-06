VERDICT: PASS

# Security review: 010-P5-fund-relay, round 1 (phase mode, money: yes)

Scope: `git diff 5690b08~1 HEAD -- apps/relayer/src/relayer.ts` (+ tests in 5690b08), `apps/relayer/src/contracts.ts` (capitalMarketAbi), `contracts/src/CapitalMarket.sol` (fundWithAuthorization, _prepareFunding, quote, fundingNonce).

Checks run: `cd apps/relayer && npx tsc --noEmit` (clean), `npm test` 53/53 pass, including the 3 new fund tests.

## Questions from the caller

- **Can the fund path call anything else or send money elsewhere?** No. `parseFunding` (relayer.ts:274-293) hard-codes `functionName: 'fundWithAuthorization'` and `target: CAPITAL_MARKET`. The `investor` field is the only address the client supplies. `calldata`/`simulateCall` use a closed switch over the three allowlisted functions. On chain, cost goes investor -> CapitalMarket -> `offer.merchant` (CapitalMarket.sol:186-201), and the claim tokens are minted to the investor. The relayer takes no fee, so nothing goes anywhere the investor did not sign for.
- **Does the signature check bind to CapitalMarket?** Yes. relayer.ts:318 uses `to: p.target` (CapitalMarket for fund), value = on-chain `quote`, nonce = on-chain `fundingNonce`, which binds chainid, market, claimId, investor, units and salt. The test "a signature made for another contract (to = MerchantPay) is bad_signature" covers it.
- **Is the 1 USDT minimum applied before simulate/send?** Yes. `prepareFunding` sets `amount = quote(...)`, then `localChecks` (relayer.ts:317, `feeOnTop: false`) rejects `below_minimum` before `rpcChecks`/`simulate`. An unknown claim gives `quote = 0`, which is also refused. The test asserts that nothing is simulated or sent.
- **Dust / ineligible / closed offer / merchant funding itself:** dust is caught by the minimum. A closed, cancelled, settled or expired offer, oversold units, an invoice that is no longer open, and `investor == merchant` (`MerchantCannotFund`) all revert in `_prepareFunding`, so the pre-send simulation rejects them at zero gas. The simulation runs again inside the send lock.
- **Quote changing between read and send:** the signature commits to the quote value, so a changed quote (or `sold` moving) makes the on-chain `receiveWithAuthorization` fail. The in-lock re-simulation catches this before signing. The only window left is simulate -> inclusion: a front-run by anyone submitting the same signature, `cancelAuthorization`, or the investor moving their USDT. Worst case is one reverted tx: the investor gets banned and the breaker and budget count it. That is the same bound as the sale and invoice paths.
- **Investor with code:** `getCode(p.from)` rejects with `payer_has_code` (relayer.ts:357), and ECDSA recovery never returns a contract.

## Findings (none block)

### LOW-1: two RPC reads happen before the free ledger gates
relayer.ts:438. `prepareFunding` runs `quote` and `fundingNonce` before `ledgerChecks` (breaker, ban, rate limit, budget). A banned investor, or a flood while the breaker is open, still costs 2 RPC reads per request. No gas is spent.
Fix: call `ledgerChecks(client, p)` before `prepareFunding` (it only needs `p.from`). Owner: relayer.

### LOW-2: no per-merchant rate key on funding
relayer.ts:142. For fund, `p.merchant` is undefined, so `sendKeys` returns only the payer key. Sybil investors who reuse the same 1 USDT against one offer are limited only by ban per payer, the breaker and the daily budget. They cannot drain past the budget.
Fix (optional): key funding on `claim:<claimId>`. Owner: relayer.

### INFO-1: target and functionName are set separately
`send` signs to `p.target` (relayer.ts:396) while `simulateCall` uses hard-coded addresses. They agree by construction today. Deriving `to` from `functionName` in one place would stop them drifting apart. Owner: relayer.

### INFO-2: the batch spec is still a template
`.batches/010-P5-fund-relay/spec.md` still has `TODO-SPEC` and no SRS IDs. This is a pipeline gate issue for the orchestrator, not a security one.

## Secret grep
Ran `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on relayer.ts and relayer.test.ts. Hits: the env var name `RELAYER_PRIVATE_KEY` (relayer.ts:88,89,94; test:751-760), the public USDT domain separator (test:231) and the secp256k1 curve order N (test:576). None is a secret, and no key value appears in any file.
