VERDICT: PASS

Code review round 1 (fast mode, PIPELINE.md §3a). Diff: `git diff 827ffe8~1 8259489 -- apps/relayer`.
Commands: `cd apps/relayer && npx tsc --noEmit` → exit 0; `npm test` → tests 42, pass 42, fail 0.

## DONE (checked, no finding)
- Arg order matches MerchantPay.sol:135 / :163 and ARCHITECTURE §2 rows 60–61: `paySale(merchant, orderRef, from, amount, validAfter, validBefore, salt, v, r, s)`, `payInvoice(id, from, amount, validAfter, validBefore, salt, v, r, s)`.
- Nonce: `merchantPayNonce` = MerchantPay.sol:241–249 (sale ref = `uint256(uint160(merchant))`, invoice orderRef = `bytes32(0)`), via shared `nonceParams`. The test pins it against an independent `encodeAbiParameters` layout (test:30–35, :722).
- Fee on top: an invoice signs and is balance-checked at `amount + relayFee`; the call carries `amount` (contract :156–157). A sale signs `amount` only. The 1 USDT minimum applies to sales only (contract :145 enforces its own rule for invoices).
- Allowlist (FR-REL-2): the parser accepts only `paySale`/`payInvoice`, `to` is always `MERCHANT_PAY`, and calldata is built from `merchantPayAbi`. `pull`/`refund` → 400 (test:198).
- Batch-002 guards are all still there: lock, re-simulate, tooLate re-checks, 400k gas / 6 gwei, sync send, receipt-hash check, sent set before send. `localChecks` moved inside the try, so a failed `relayFee` read is a 502 and no longer an unhandled throw. That is correct.
- `paymentId` is read from a `Paid` log filtered to MerchantPay's address. Error names come from viem's decoded `errorName`. ABI, addresses, domain and types come from `packages/shared` (batch-002 F2 closed).

## FOLLOW-UP (MEDIUM/LOW, not blocking)
1. MEDIUM `apps/relayer/src/relayer.ts` (send, `gasCostWei`): whitechainSepolia uses viem's OP Stack formatter, so the receipt carries `l1Fee`. `gasUsed * effectiveGasPrice` leaves out the L1 data fee, so the receipt and the batch-006 budget will undercount. Fix: `+ (receipt.l1Fee ?? 0n)`. Owner: relayer.
2. LOW relayer.ts `simulationReject`: a sale with `orderRef = 0x00…00` reaches the RPC round and comes back as `bad_merchant` (contract `InvalidOrder`). A local `orderRef === zeroHash` → 400 in `parsePayment` takes one line. (The tester flagged this too.) Owner: relayer.
3. LOW ponytail: `export const USDT_DOMAIN = usdtDomain` (and the `USDT` export) exist only for the tests. The tests can import `usdtDomain`/`addresses` from `packages/shared` and the aliases can go. Owner: relayer.
4. LOW scope: `apps/relayer/tsconfig.json` (`module: preserve`) is not in the spec's Files list. It is needed to import `packages/shared` and build-relayer.md records it, so this is a note only.
5. LOW: `EnforcedPause` maps to the generic `would_revert`. Fine until the pause switch (batch 006).

## NEEDS THE USER
- None.
