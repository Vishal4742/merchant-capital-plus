VERDICT: PASS

# Security review: 022-P2-relayer-resilience, round 1

Reviewer: reviewer-security (subagent of claude-relayer). Scope: `git diff origin/main...HEAD -- apps/relayer apps/web/lib/server/capital.ts apps/web/lib/server/capital-fund.ts apps/web/test/capital-fund.test.mjs` (commits 4118bef..b752457). For context I read spec.md (with the 11:06 addendum), batch.md, ARCHITECTURE.md §2–§3, PIPELINE.md §3a, contracts/src/{ClaimToken,CapitalMarket,InvestorRegistry}.sol, apps/web/lib/relay.ts and viem 2.57.13 `estimateGas`. The round has no build-*.md and there is no earlier review of mine for this batch. Per the caller I did not re-run tests (relayer 62/0, tsc 0; web capital 28/0, typecheck, eslint). No `.env` was read, no network calls, no transactions.

No CRITICAL or HIGH findings. The send path's guarantees still hold: a tx goes only to the allowlist, it is simulated at the 400k cap before it is signed, it is signed at most once per authorization, and the spend is counted on every post-sign path. The MEDIUM and LOW items are under FOLLOW-UP.

## What I checked, and why it holds

**F1b, `ownReceipt` (relayer.ts:379-394)**
- *Success reported for a different tx?* No. The receipt is fetched by our own `keccak256(signed)` (relayer.ts:439, 445), and `send()` still compares `receipt.transactionHash` with our hash and answers 502 `receipt_mismatch` if they differ (relayer.ts:451-453). Errors that F1b now swallows only lead to another poll of the same hash.
- *Spend mis-counted?* No. Every path after signing calls `recordSend` exactly once: the timeout with no receipt (448), the mismatch (452), the mined receipt (459), and the error thrown at the deadline, which lands in the catch (465). Each unknown outcome counts the full `CAP_FEE_WEI`. Nothing records twice, so the daily budget can't be undercounted.
- *Lock hold time:* the worst case is unchanged. The deadline check runs after each call returns, so one in-flight poll can still overrun by one `RPC_TIMEOUT_MS`. That was true before this batch as well.
- *Leaks:* the thrown error becomes `reason(e)` = viem `shortMessage`, which never contains the RPC URL (and so no Ankr key path). The web never passes relayer `error` text to the browser (lib/relay.ts:83-91).

**F4, age gate (relayer.ts:433)**
- *Double-send?* No. The gate returns before `signTransaction`, so no tx exists and the sent set (440) is untouched. A later attempt with the same authorization either finds it in the sent set (419, 334) or on-chain (`authorizationState`, 360). Everything in `send()` runs inside `serialized`, and after the last `await` (signing) the hash and `sentAuthorizations.add` run synchronously. Two requests can't interleave there.
- *Sign after expiry?* No. `tooLate` re-runs at 431, right before the gate, and only synchronous `ledgerChecks` plus local signing follow it. `performance.now()` is monotonic.
- An F4 refusal records no spend and no send, which is correct because nothing was broadcast.

**Gas guard (relayer.ts:367, 373)**
- *Can making the estimate fail skip the guard?* Yes, and that is safe. `.catch(() => undefined)` falls through to `failedSimulation` (374). The simulation is `simulateContract(..., ...FEES)` (340-343), i.e. `eth_call` with `gas: 400_000`, and it runs twice: in the pre-check round and again inside the lock (422-426). Any call that needs more than 400k runs out of gas in that `eth_call` and is refused before signing. The estimate only turns that refusal into a clear 422 `too_much_gas`. It never admits anything: `gasNeeded <= 400k` can't bypass the simulation check that follows it. **The gas-capped simulation is still the real backstop.** The residual risk is state changing between the in-lock simulation and mining (e.g. a holder added in between). That ends in a mined OOG revert, which the per-payer ban and the 3-reverts/hour breaker already bound (pre-existing).
- *Does `account: address` change what's estimated?* Only in a good way. In viem 2.57.13, a non-local account means `prepare` fills only `blobVersionedHashes`, so the request carries no nonce, fees or `gas`. It does send `from = relayer`, the same sender as the real tx and the simulation. With no `gas` and no fee fields, the node searches up to the block or RPC gas cap and doesn't limit the search by the relayer's balance, so it can report 421,338. If `gas: 400k` were passed, it would just fail. The tests confirm the pre-check round has 6 calls and no `eth_fillTransaction`, nonce or block reads.
- *Does a too_much_gas reject leak anything?* No. The message shows the gas needed and the 400k limit. Both are public (anyone can run `eth_estimateGas`; the 400k limit appears in every relayed tx), and the web maps any 422 to its own generic text (lib/relay.ts:83; capital-fund.ts:93).
- *Abuse:* the estimate targets only `p.target` with `calldata(p)`, i.e. the three allowlisted calls, after the signature check. It is a read, so it costs the RPC and never the hot key. `/relay` is behind `RELAY_API_SECRET`.

**Invoice holder cap (capital-fund.ts:42-49)**
- *Case-insensitive compare:* correct. Both sides are lowercased, `f.investor` is `getAddress`-validated (capital.ts:195-196), and `holdersOf` drops zero-balance holders (ClaimToken.sol `_removeHolder` via `_move`), so the count is the live one.
- *Existing holder topping up:* allowed and correct, because a top-up adds no holder. Claiming to be an existing holder doesn't help an attacker: the signature checked at capital-fund.ts:56 and the relayer's `fundWithAuthorization` both bind the funding to `f.investor`, so impersonating holder A needs A's signature.
- *Race (two concurrent fundings each see 1 holder, so 3 holders):* **acceptable for this phase.** It needs two distinct investors on the owner-only InvestorRegistry list (`setEligible` is `onlyOwner`, and no web route calls it) funding the same invoice inside one relay window. The worst outcome is that the repayment is refused with 422 before any tx exists, so no WBT is spent and no USDT moves. The bypasses in FOLLOW-UP M1 matter more than the race.
- The check runs before the quote, the signature check and the relay, as the spec asks. The 409 reveals only the holder count, which is public on-chain.

## Secret scan

I ran `grep -noE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the 5 files in the diff (hex masked in my output). **Added diff lines: 0 hits.** The hits in the full files are all benign:
- relayer.ts:90, 91, 96: the `RELAYER_PRIVATE_KEY` env var name and the fixed error message.
- relayer.test.ts:233: the public USDT `DOMAIN_SEPARATOR`.
- relayer.test.ts:656: `SECP256K1_N`, the curve order constant.
- relayer.test.ts:831-840: the "unparsable key is never printed" test, which builds `0x` + `f`×64 at runtime.
- capital-fund.ts:74: the `RELAY_API_SECRET` env var name.

No key, token or mnemonic.

## FOLLOW-UP

### M1 (MEDIUM): the 2-holder invoice cap applies only to web funding; holders can be added in other ways and advances aren't covered
- **Where:** apps/web/lib/server/capital-fund.ts:42-49, apps/web/lib/server/capital.ts:152 (`transferCheck`), contracts/src/ClaimToken.sol:38 (`MAX_HOLDERS = 8`), contracts/src/CapitalMarket.sol:168 (`fund`), 176 (`fundWithAuthorization`, "anyone submits it"), 207-235 (`onPayment`), 329 (`_distribute` pushes to every holder).
- **Failure scenario (invoice):** investor A holds an invoice claim with B. A uses the product's own transfer flow, and `transferCheck` (capital.ts:152) allows the transfer because it checks only the 8-holder cap. A sends 1 unit to listed investor C from A's own wallet. Now there are 3 holders and the full repayment needs 421,338 gas. The relayer returns 422 `too_much_gas` and the web shows the customer "That approval didn't work… please try again", every time. The same happens through a direct `CapitalMarket.fund` or a self-submitted `fundWithAuthorization`. No funds are lost and default/recourse isn't built yet (Phase 5), but that invoice can no longer be paid through the gasless checkout. This could also happen in the AT-8 transfer demo.
- **Failure scenario (advance, pre-existing but now explicit):** ARCHITECTURE.md:97 measures a routed sale at 278k gas with 1 holder and about 537k with 8, roughly +37k per holder. So an advance with about 5 or more holders pushes **every** gasless sale of that merchant over 400k, and each sale is refused with `too_much_gas`. Advances are repaid only through sales. The test asserts that advances aren't capped (capital-fund.test.mjs, "advances aren't capped here"). A related case: a payInvoice on a partly-sold invoice claim sends the rest of the payment to the merchant's advance in the same tx (onPayment), so a 2-holder invoice plus a multi-holder advance may also exceed 400k. That combination is unmeasured.
- **Fix:**
  1. Web, now: apply the same per-kind holder rule in `transferCheck` (refuse a transfer that would make a 3rd invoice holder), and add an advance cap at the largest holder count whose routed sale stays under 400k. That looks like 4, but measure it.
  2. Map `too_much_gas` to its own message in lib/relay.ts so a payer isn't told to retry.
  3. Contracts, later: a per-kind holder cap in `ClaimToken._addHolder`, or the pull accumulator the ClaimToken ponytail note already names. Only an on-chain rule closes the transfer, direct `fund` and race paths.
- **Owner lanes:** claude-relayer (capital server: transferCheck and the advance cap), claude-frontend/web (relay.ts message), claude-contracts (measure the k-holder advance sale and the 2-holder partly-sold invoice plus advance; on-chain cap).

### L1 (LOW): F4's 502 maps to "don't pay again" on the web, not "nothing was charged; retry"
- **Where:** relayer.ts:433; apps/web/lib/relay.ts:87, 91; capital-fund.ts:96-97.
- **Scenario:** a queued sale is refused by F4 with nothing sent. The web turns every 502 into 504 UNKNOWN ("We couldn't confirm this payment yet. Don't pay again"), and the sale stays pending for a tx that never existed. This fails safe (no double charge), but it contradicts AT-10's "safe to re-POST". The spec's reason for using 502 ("not a new 503 code the web doesn't know") doesn't match the web: the web maps every 503 to BUSY ("Nothing was charged; try again") whatever the code.
- **Fix:** answer 503 with a distinct code (e.g. `queue_timeout`), or have the web treat a 502 without `txHash` as not sent.
- **Owner:** claude-relayer (with claude-frontend if the web side changes).

### L2 (LOW): the age gate runs only after the in-lock RPC round
- **Where:** relayer.ts:417-433.
- **Scenario:** the RPC hangs and one send holds the lock for about 30 s. Every request queued behind it is already older than 20 s, but each one still runs simulate ‖ nonce inside the lock (up to 8 s each when the RPC hangs) before F4 refuses it. Head-of-line blocking therefore grows by about 8 s per queued request. This affects availability only, never money.
- **Fix:** also check `clock.read().total > TIMING.maxRequestAgeMs` right after `clock.lap('queue')` (418). Keep the existing check at 433.
- **Owner:** claude-relayer.

### L3 (LOW): the timing budget in the comment and spec misses two overruns
- **Where:** relayer.ts:22; spec.md F4.
- **Scenario:** once past the 20 s gate, the relayer can still spend up to 8 s on `sendRawTransaction` and 8 s on the receipt window, plus up to 8 s for one in-flight poll. That totals about 44 s, more than the web's 35 s give-up. This is safe because the web treats its own timeout as UNKNOWN and settles from the chain, but the "stays under 35 s" claim is wrong.
- **Fix:** correct the comment, or lower `maxRequestAgeMs` to about 10 s if the 35 s promise matters.
- **Owner:** claude-relayer.

### L4 (LOW): `ownReceipt` can throw an old error instead of reporting "not mined"
- **Where:** relayer.ts:386-389.
- **Scenario:** one 429 at about 1 s, then receipt-not-found until the deadline. The deadline throws the old 429, so the 502 reads "Request exceeds defined limit" instead of "not mined within 8 s; poll the txHash". The status, code, `txHash` and recorded fee are the same either way; only the message changes.
- **Fix:** clear `lastError` on `TransactionReceiptNotFoundError`, or throw only if the last poll errored.
- **Owner:** claude-relayer.

### L5 (LOW): payments within ~1.5% of 400k can be refused even though they fit
- **Where:** relayer.ts:373.
- **Scenario:** geth's estimator stops within a 1.5% tolerance above the minimum gas a call needs. A payment that needs 395k and would pass the exact 400k simulation can be estimated at about 401k and refused with `too_much_gas`. This fails safe (a refusal, never a send). The routed-sale curve puts 4-holder advances near this boundary.
- **Fix:** nothing needed now. If it shows up, refuse only when the estimate is above 400k **and** the simulation failed, or compare against about 406k.
- **Owner:** claude-relayer.

Out of scope and unchanged: F9 (global breaker; needs the human), and the per-process sent set and ledger (ponytail, batch 006).
