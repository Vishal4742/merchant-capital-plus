VERDICT: PASS

# Security review, batch 045-P5-invoice-gas-limit, round 1

Reviewer: reviewer-security (claude-relayer lane, Money: yes: relayer gas and the daily budget).
Diff: `git diff 3ea2291~1 HEAD -- apps/relayer/src apps/relayer/test` (RED 3ea2291, GREEN 61699e1; `git log 3ea2291~1..HEAD -- apps/relayer` shows only these two commits, so the merges bring no other relayer change). Files: apps/relayer/src/relayer.ts, apps/relayer/test/relayer.test.ts. Spec: FR-REL-5, FR-REL-10, FR-INV-1..5, FR-ADV-4, AT-10.

I found nothing CRITICAL, HIGH or MEDIUM. Three LOW findings and five INFO notes are listed under FOLLOW-UP below. None of them blocks this batch.

## Commands run

- `cd apps/relayer && npm test`: `tests 78, pass 78, fail 0` (the four M3 tests are included).
- `npx tsc --noEmit`: exit 0.
- `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` on both diff files found the following:
  - relayer.ts:105, :106, :111: the env var *name* `RELAYER_PRIVATE_KEY` in the loader and in its error text.
  - test/relayer.test.ts:241: the public USDT domain separator.
  - test/relayer.test.ts:664: the secp256k1 order N.
  - test/relayer.test.ts:839-848: the env var name, used in a test.

  All of these were already there before this batch. None is in an added line: `git diff … | grep '^+' | grep -E …` returns nothing (exit 1). No key, token or connection string is committed.

## The focus questions

### 1. Can a payer make the relayer burn more gas than intended?
**Answer:** only up to the signed limit. A burn of the full limit needs an out-of-gas revert. An OOG can only come from state that changes between the **in-lock** simulation and inclusion. The payer has very few levers there.

- **The limit is server-chosen.** `parsePayment` builds the `Payment` field by field (relayer.ts:265-279, :298). No body field reaches `p.gas`. `p.gas` is set in exactly one place, relayer.ts:532, from `gasLimit()`. `gasLimit()` clamps every value to at most 600k (relayer.ts:52-57) and returns 400k for anything that is not `payInvoice`.
- **A low estimate followed by high real execution is caught before signing.** The in-lock simulation runs at `p.gas`, the exact limit the tx is then signed with (relayer.ts:337, :464-468, :476). The test at test:1248 checks `[600k, limit]`. If state grew while the request was queued, that simulation runs out of gas and nothing is signed. The client sees a 502 `rpc_error` (INFO-3), and its retry gets a fresh estimate.
- **The remaining window is the in-lock simulation → the block (about 1 s).** The payer controls only these levers there:
  - its own USDT balance or nonce: a normal revert, which refunds the unused gas;
  - its own balance going to zero: a refund, which lowers the gas.

  The levers that *raise* invoice gas belong to other parties: claim holders splitting units (at most 8 holders, eligible investors only, before the lock) and holders emptying their USDT (0 → non-zero SSTORE). M3 was already measured with every holder at 0 USDT, so that dimension is at its worst case. See L1.
- **A failed estimate gives 600k, but that does not cause a burn.** A larger limit costs more only on an OOG, and the 600k pre-lock and in-lock simulations still decide whether the tx is sent. A payer can't make `eth_estimateGas` fail on its own. The only route I found is execution above the RPC's gas cap, and then the 600k simulation fails too and nothing is sent. The contracts don't use `gasleft()`, `tx.gasprice` or `block.basefee` (I grepped contracts/src). So an estimate that reverts while the simulation passes can only come from a lagging node behind Ankr. See INFO-2.
- **63/64 and `trySafeTransfer`.** I checked whether a tight limit could make the holder pushes in `CapitalMarket._distribute` (CapitalMarket.sol:353-358) fail inside the call and silently become `owed` balances while the tx still succeeds. It can't:
  - After an inner OOG the outer frame keeps 1/64 of its gas.
  - The fallback branch alone (`owed[h]` 0 → non-zero, `totalOwed`, `PushFailed`) costs about 29k.
  - So the outer frame would need about 1.9M gas available at the CALL. Under a 600k limit the outer frame runs out of gas too and the tx reverts. It never succeeds with the pushes downgraded.
  - This also means `eth_estimateGas`'s binary search can't settle on such a point.

### 2. Is every send's worst case counted, before the lock, inside the lock and in `rel_sent`?
Yes.

- **Before the lock:** `ledgerChecks` runs from `localChecks` (relayer.ts:333) while `p.gas` is still unset. So `worstFee(p)` = `maxGas(p)` × 6 gwei = 0.0036 WBT for an invoice and 0.0024 for the other kinds (relayer.ts:50, :164). The test at test:1282 confirms that an invoice is refused at 0.097 spent with **no RPC call at all**, while a sale at the same 0.097 still goes through.
- **Inside the lock:** `ledgerChecks` runs again with `p.gas` set (relayer.ts:460 → :164), so the check uses the chosen limit × 6 gwei. Under the lease, nothing else can write `rel_sent` between this read and `reserve` (batch 037).
- **`rel_sent`:** `reserve` writes `worstFee(p)` (relayer.ts:482). This is the same expression the in-lock check used and the same limit the tx was signed with. The test at test:1282 asserts `548,657 × 6 gwei` for an unmined invoice.
- **Receipt:** `gasUsed × effectiveGasPrice + l1Fee` replaces the reservation (relayer.ts:499-501 → store.ts:133-134).
- **Arithmetic:** 600k × 6e9 = 3.6e15. That fits `bigint`, and so does the daily sum.
- **Margin:** the worst case at 6 gwei is above the real ≈5.001 gwei (ARCHITECTURE.md:154: 5 gwei floor), so the reservation stays conservative.
- **One gap, not new:** the reservation excludes the OP Stack L1 data fee. See INFO-1.

### 3. Does a mined out-of-gas revert still ban the payer and feed the breaker?
Yes, whenever the receipt is seen.

- An OOG receipt has `status: reverted`, so `reverted = true` (relayer.ts:500).
- `settleSend(p, gasCostWei, true, …)` (relayer.ts:501, :172-177) then calls `store.settle(key, fee, true)`.
- `counters` turns that into `banned` (`bool_or(reverted AND payer = $2)`) and `revertsLastHour` (store.ts:76-77).
- The full limit is charged and recorded: `gasUsed` = limit on OOG.

This path doesn't depend on the payment kind. The breaker test at test:938 uses sales; an invoice-at-600k version is missing (INFO-5). If no receipt arrives within 8 s, or the poll throws (relayer.ts:493, :507), there is no ban and no breaker tick, but the worst case stays reserved. That gap predates this batch (INFO-4).

### 4. Is there any path where `p.gas` is unset at sign time?
No.

- `send()` is reachable only through `relay()` (relayer.ts:537).
- The closure reads `let p` after the assignment at :532, and `p` is never reassigned afterwards.
- `rpcChecks` is the only producer of `{ gas }` and has a single caller (grep).
- Even if `p.gas` were unset, the fallback `p.gas ?? maxGas(p)` is the same expression in `worstFee` (:50), `simulateCall` (:337) and the signature (:476). So the simulation, the signed limit and the reservation could not diverge.

### 5. Does AT-10 (every rejection before a tx exists) still hold?
Yes.

- The new rejection paths both come before `signTransaction`: `too_much_gas` above the kind's maximum (relayer.ts:373-375), and an in-lock simulation that fails at the chosen limit (relayer.ts:468).
- The only new code between `signTransaction` and `sendRawTransaction` is `worstFee(p)`, which is pure.
- `'code' in checked` (relayer.ts:531) is a sound check: every `Reject` has `code`, and `{ gas }` doesn't.
- The sale and funding tests (test:588, :1271) confirm that 421,338 gas is still `too_much_gas` and `node.sent.length === 0`.

### Checklist items that don't apply or are unchanged
- The allowlist is unchanged: the target comes from the parsed kind, and the calldata comes from fixed ABIs.
- Simulate-before-send now runs at the signed limit at both stages.
- The fee is still inside the tx: invoices carry `relayFee` on top.
- The 6 gwei price cap is unchanged. The rate limits and the key handling are untouched.
- There is no contract or web change in this batch's files.

## FOLLOW-UP (none of these blocks the batch)

### L1 (LOW): a claim holder can force an OOG on an honest invoice payer. The worst burn per incident goes from 0.0024 to 0.0036 WBT, and the payer is banned
- **Where:** relayer.ts:52-57 (the limit), :464-468 (the last simulation), :500-501 (the ban on any mined revert).
- **Scenario:**
  1. An eligible investor X holds units of invoice I's claim, before the claim's lock window.
  2. An honest payer P POSTs a `payInvoice` for I. The estimate is about 457k, so the limit is 548,657, and the in-lock simulation at 548,657 passes.
  3. X watches the sequencer mempool, or simply sends a ClaimToken split to several eligible addresses with a tip above our 0.001 gwei. The split lands in the same block, ahead of our tx.
  4. Our tx now needs more than 548,657 gas, so it runs out of gas. It burns the whole limit, about 0.0027 WBT at the 5 gwei floor (0.0036 at most).
  5. P is banned forever, and the breaker counts one revert. Three such reverts in an hour open the breaker for every user.
- **Severity:** the class predates this batch. At 400k, a split could also OOG a lighter invoice. It is LOW because:
  - X must be an owner-approved investor (InvestorRegistry.sol:26 `setEligible` is `onlyOwner`; no web route calls it);
  - the race window is about one block;
  - the breaker and the daily budget bound the loss.
- **Fix:** nothing for this batch. Optionally, as a follow-up: when `receipt.gasUsed === p.gas` (a mined OOG on a tx simulated at that exact limit), log an `ALERT oog` so the operator can unban a payer who did nothing wrong. Keep the ban itself, to fail safe. Owner: claude-relayer.

### L2 (LOW): estimates between 500k and 600k get less than the 1.2 margin
- **Where:** relayer.ts:55-56. For example, an estimate of 590,000 gives a limit of 600,000, which is 1.7% headroom.
- **Scenario:** an invoice shape that hasn't been measured (more holders, or a larger advance) estimates at about 590k. A small state change between the in-lock simulation and the block, such as one holder emptying its USDT (about +17k), pushes it past 600k. The result is a mined OOG at 600k: about 0.003 WBT burnt and an honest payer banned (L1's consequences, with no attacker needed).
- **Context:** the spec requires 504,115 → 600,000, so the human accepted a margin below 1.2 in this band. The measured maximum, 504,115, still has 19% headroom.
- **Fix:** none needed now. If an invoice shape above about 520k ever shows up in the forge gas tests, either refuse when `estimate × 1.2 > 600k` or raise `INVOICE_GAS_MAX`. Both need a human decision. Owner: claude-relayer + claude-contracts (measurement).

### L3 (LOW, accepted cost): heavy invoices make the daily-budget denial of service about 2-3× cheaper
- **Where:** relayer.ts:164-166. The merchant limit applies only when `p.merchant` is set, and invoices leave it unset. The payer limit is 10/hour per address, and new addresses are free.
- **Scenario:**
  1. A merchant M controls a partly-sold invoice with a running advance, funded by eligible investors M also controls.
  2. M makes partial `payInvoice` payments of at least 1 USDT from four fresh payer addresses, 10/hour each.
  3. Each payment burns about 500k × 5 gwei ≈ 0.0025 WBT, against 0.10 USDT of fee income.
  4. About 40 relays use up the 0.1 WBT day, and every user gets 503 `budget_exhausted` until 00:00 UTC.
  5. The cost to M is about 4 USDT in fees (the partial amounts go back to M's own holders). Draining with sales took about 90-130 relays.
- **Why LOW:** the spec's "Known cost" accepts the per-relay loss, the budget cap contains the money, and the setup needs owner-approved investors. The failure is availability, and it would matter during judging.
- **Fix (follow-up, human decision):** a per-`invoiceId` hourly limit, or a sub-budget for sends above 400k. Owner: claude-relayer.

### INFO-1: the worst-case fee excludes the OP Stack L1 data fee
relayer.ts:50. `worstFee` = limit × `maxFeePerGas`, and the receipt adds `l1Fee` on top (relayer.ts:498-499). The day can therefore overshoot 0.1 WBT by one send's L1 fee. The calldata has a fixed size (about 292 bytes), so the amount is negligible. This was already true of `CAP_FEE_WEI` before this batch (security 037 noted the same). No action needed.

### INFO-2: the spec and the code differ on what counts as a "failed estimate"
The spec says "an RPC error, not a revert" gets 600k. relayer.ts:367 `.catch(() => undefined)` treats a reverting estimate the same way, and the test at test:597 depends on that. This is safe:
- the contracts have no gas-dependent branches, so an estimate revert means the 600k simulation also reverts and the payment is refused;
- the only exception is a lagging node, and then the in-lock simulation at 600k still decides.

No code change. Optionally reword the spec or the comment. Owner: claude-relayer.

### INFO-3: an in-lock simulation that runs out of gas is reported as `rpc_error`
relayer.ts:468 → :224. On geth/op-geth an OOG in `eth_call` comes back as -32000, not as a revert, so the user sees "the RPC node failed during simulation" (502). Nothing is sent, and the client's retry gets a fresh estimate and a new limit. This is a UX issue only. Optionally map an OOG message to 503 `busy` or `too_much_gas`. Owner: claude-relayer.

### INFO-4: a mined revert whose receipt we never see doesn't ban the payer or feed the breaker
relayer.ts:493 and :507. This was already the case before this batch, and the worst case stays reserved. With invoices now signed at up to 600k, a late-mined OOG costs up to 0.0036 WBT with no ban. A follow-up could reconcile `rel_sent` rows that have no receipt (look up each `tx_hash` later and call `settle`). Owner: claude-relayer.

### INFO-5: no test covers a mined invoice revert above 400k
The ban and breaker test (test:938) and the accounting test (test:962) use sales only. The logic doesn't depend on the payment kind, so this isn't blocking. Suggested test: an invoice with an estimate of 504,115 and `minedRevert: true`, `gasUsed: 600_000n`. It should assert that the `rel_sent` fee is 600k × price + L1, that the next payment from that payer is `payer_banned`, and that the breaker count rises. Owner: claude-relayer.

### Docs (for claude-research)
ARCHITECTURE.md:94 drain guard (5) still says "gas limit 400k". It should read "400k; `payInvoice` clamp(ceil(estimate × 1.2), 400k, 600k), refused above 600k; worst case per send = its limit × 6 gwei". Owner: claude-research.
