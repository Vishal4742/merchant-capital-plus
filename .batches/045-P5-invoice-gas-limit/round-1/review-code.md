VERDICT: PASS

# reviewer-code, batch 045-P5-invoice-gas-limit, round 1

Scope reviewed: `git diff 3ea2291~1 HEAD -- apps/relayer/src apps/relayer/test` (RED 3ea2291 = tests only, GREEN 61699e1 = `relayer.ts` only), with `apps/relayer/src/relayer.ts` read in full and the fake node in `apps/relayer/test/relayer.test.ts` read.

Verified (run in `apps/relayer`):
- `npm test`: tests 78, pass 78, fail 0.
- `npx tsc --noEmit`: exit 0.

## Checks

1. **Traceability and scope.** Every change maps to FR-REL-5 (gas limit cap) or FR-REL-10 (budget, `rel_sent` reservation), as spec.md says. Only the two spec files changed. No scope creep: sale and funding limits stay the same, and the fee and contracts are untouched.
2. **ABI (ARCHITECTURE §2).** The calls are still `MerchantPay.paySale` / `.payInvoice` and `CapitalMarket.fundWithAuthorization` with the same args, and no events changed. The `/relay` request and response shapes are unchanged.
3. **Logic.**
   - `gasLimit` (relayer.ts:52-57). `(e*12n + 9n)/10n` is the exact ceiling of 1.2e for e ≥ 0. Worked examples: 457,214 → 548,657; 421,338 → 505,606 (505,605.6 rounded up); 500,000 → 600,000 exactly, with no overshoot on exact multiples. The clamp to 400k–600k is correct. An estimate above 600k never reaches `gasLimit`: it is rejected first (373-375). An estimate of 0 gives 400k.
   - A failed estimate (undefined) gives 600k for an invoice and 400k for a sale or funding. A reverting estimate is handled the same way, and the gas-capped simulation still decides (376). That matches the spec.
   - **Simulations.** The pre-lock simulation runs in the same `Promise.all` as the estimate while `p.gas` is still undefined, so it runs at `maxGas(p)`: 600k for an invoice, 400k for everything else (337). Inside the lock, `p.gas` is the chosen limit (532), so the simulation (465), the signature (476) and the `rel_sent` reservation (482) all use the same value. The pre-lock budget check uses `worstFee` with the kind's maximum (0.0036 WBT for an invoice). The in-lock check uses the chosen limit. All as the spec says.
   - **`relay()` restructure** (528-532). The order is the same as the old `local ?? rpc`. If local checks reject, there is no RPC round. `rpcChecks` keeps its order (replay → payer_has_code → insufficient_funds → gas_price_cap → too_much_gas → simulation reject), and its only fall-through path that used to return `undefined` now returns `{ gas }`. `'code' in checked` is a safe discriminator (every `Reject` has `code`), and the same pattern is already used at 541. It is still inside the same try/catch, so `StoreError` and RPC errors map exactly as before. No reject code or order changed. `p = { ...p, gas }` makes a new object, so nothing is mutated.
4. **The test changed on purpose** (relayer.test.ts:587-595). The test moves from an invoice to a sale at 421,338. It still asserts 422 `too_much_gas`, nothing sent, and a refusal in the pre-check round (no `eth_getTransactionCount`), now against the 400k limit, which is the guard that still exists. The invoice side of that guard (above the kind's maximum → 422, never sent) is now covered at 600,001 (1260-1265), a tighter boundary than the spec's 610,000. The 421,338 invoice → 505,606 change the spec names is asserted at 1250.
5. **Do the tests catch the mutations?**
   - Wrong multiplier, or floor instead of ceiling: caught by 457,214 → 548,657 and 421,338 → 505,606.
   - Missing lower clamp: 310,000 → 400,000 (it would give 372,000).
   - Missing upper clamp: 504,115 → 600,000 (it would give 604,938).
   - Signing at the kind's maximum: the signed gas is 548,657, not 600k (1255).
   - In-lock simulation at the kind's maximum: `simulations` must equal `[600k, limit]` (1256).
   - Reserving at the kind's maximum: `fee_wei` must equal 548,657 × 6 gwei (1287).
   - Pre-lock budget at 400k for an invoice: the invoice is refused at a spend of 0.097 with no RPC calls (1291-1293).
   - Sale or funding given 600k: caught by 421,338 → `too_much_gas` (1272-1275) and by the sale signed and simulated at 400k (1278-1279).

No HIGH or CRITICAL findings.

## FOLLOW-UP (LOW, fix in the next relayer batch; none block)

1. **ARCHITECTURE.md:94, drain guard point (5), still says "gas limit 400k".** Invoices now go up to 600k, and the worst-case fee per invoice send is 0.0036 WBT. Fix: claude-relayer posts the change on agentbus. Owner: **claude-research** (lanes don't edit shared docs).
2. **relayer.ts:52-57, `gasLimit` repeats the `payInvoice` check that `maxGas` (48) already makes.** For sales the floor equals the maximum (400k), so one clamp covers both kinds and leaves one place that says "invoices get 600k". Fix:
   ```ts
   function gasLimit(p: Payment, estimate: bigint | undefined): bigint {
     const max = maxGas(p);
     if (estimate === undefined) return max;
     const padded = (estimate * 12n + 9n) / 10n;
     return padded < GAS_LIMIT ? GAS_LIMIT : padded > max ? max : padded;
   }
   ```
   Optional. While there, `GAS_LIMIT` (46) is both the sale limit and the invoice floor; `GAS_MIN` or `SALE_GAS_LIMIT` would say what it is. Owner: claude-relayer.
3. **relayer.ts:50, 337 and 476 each repeat `p.gas ?? maxGas(p)`.** The invariant "simulated = signed = reserved" depends on these three copies staying the same. A single `const gasOf = (p: Payment) => p.gas ?? maxGas(p);` would make that structural. Optional. Owner: claude-relayer.
4. **Gaps in the test boundaries** (relayer.test.ts). Owner: claude-relayer.
   - 1266-1268: the failed-estimate path asserts the signed 600k but not `simulations` = `[600k, 600k]`.
   - 1288-1293: the budget check is not tested at its exact boundary. A spend of 0.1 − 0.0036 WBT should pass the pre-lock check, and 1 wei more should be refused. Without that, a pre-lock check at any limit between about 500k and 600k would also pass.
   - 1250: no exact multiple below the clamp (for example 450,000 → 540,000). A `+10n` instead of `+9n` (1 gas too high on exact multiples) would get through.
   - Funding is never asserted to sign or simulate at 400k; only its `too_much_gas` is tested.
5. **Process: no `build-relayer.md` and no `round-1/ci.md` yet.** In phase mode, `batch-close.sh` needs `ci.md` (plus `review-security.md`, since `Money: yes`). Owner: claude-relayer.

## NEEDS THE USER (PIPELINE §11: relayer limits and budgets; already accepted, listed so it stays visible)
- The 600k ceiling leaves estimates between 500k and 600k with less than 20% headroom: an estimate of 550k gets a 600k limit, about 9%. The measured worst case, 504,115, gets 19%. If state grows past the limit between the in-lock simulation and the block, the tx is mined as an out-of-gas revert. That bans an honest payer, and it counts toward the 3-per-hour breaker. The spec sets this ceiling (claude-contracts M3, human 19:1x).
- About 0.003 WBT of gas per 500k invoice relay is more than the 0.10 USDT relay fee. Accepted in the spec (human 19:1x).
