VERDICT: PASS

# Code review: 002-P2-merchantpay, round 1 (reviewer-code)

Scope: `git diff 44772c7..HEAD -- contracts packages` at HEAD 3c3d85a (f885e37, a67d260, 2424138, 099bb97, 3c3d85a; `contracts/lib` ignored). I read `contracts/src/MerchantPay.sol`, both test files, both scripts, `export-abi.sh`, `foundry.toml` and `packages/shared/merchantPay.ts` in full, against spec.md (including "Pinned after plan review"), ARCHITECTURE §2 and SRS. No round 0, so there are no earlier findings to re-check.

No blocking findings. Every finding below is LOW or INFO. Two of them need a redeploy and belong in the Phase 3 MerchantPay batch (already planned). The rest are script or test hygiene for the next contracts batch.

## What I checked myself (commands and output)
| Check | Output |
|---|---|
| `forge build` / `forge fmt --check` / `forge lint` | `No files changed, compilation skipped` · fmt exit 0 · lint exit 0, no findings |
| `forge test --match-path 'test/MerchantPay*.t.sol'` at 3c3d85a | `27 passed` + `5 passed`, `32 tests passed, 0 failed` |
| Shared file vs viem: `tsc` 7.0.2 (from apps/relayer, strict, `verbatimModuleSyntax`, `erasableSyntaxOnly`) on a scratch file that imports `merchantPay.ts` and calls `encodeAbiParameters(nonceParams, …)`, `hashTypedData({domain: usdtDomain, types: receiveWithAuthorizationTypes, …})`, `encodeFunctionData({abi: merchantPayAbi, functionName: "paySale" / "invoices", …})`, `parseEventLogs<…, "Paid">` | `tsc exit=0`; `addresses.merchantPay` is assignable to viem `Address` |
| Nonces computed with viem 2.57.13 from `nonceParams` vs live `cast call` on `0x83b5…73b7` | sale `0x25323a78…c06c109` = chain; invoice `0x8c1c0239…7f6e2699` = chain |
| `usdtDomain` hashed in viem vs live USDT `DOMAIN_SEPARATOR()` | both `0xcdcfacb6…1d3d2a25` |
| Live state (read-only) | owner deployer, `paused` false, `relayFee` 100000, `feeRecipient` `0xdd02…a651`, `paymentCount` 1 |
| `export-abi.sh` regenerated in a scratch tree (copied `out/` artifact + deploy record) | output `cmp`-identical to the committed `packages/shared/merchantPay.ts` |
| `forge inspect src/MerchantPay.sol:MerchantPay abi --json` vs `out/…/MerchantPay.json` `.abi` | `same ABI: True 51 51` (used for finding 2) |

## Review checklist
1. **Traceability and scope.** Every function traces to a cited ID: createInvoice FR-PAY-1, cancelInvoice FR-PAY-2, payInvoice FR-PAY-3/6, paySale FR-PAY-5/6, refund FR-PAY-8, setRelayFee/MIN_PAYMENT/MAX_FEE FR-REL-4, permissionless pay FR-REL-7, pause FR-REL-9, the CEI order and guard NFR-1, the split NFR-2. `acknowledge`, `setMarket` and partial payments are absent, as the out-of-scope list says. Nothing was built beyond the spec. `invoiceCount`/`paymentCount` are public counters that the ids need; they aren't new features. See INFO 6 for three files that the "Files to touch" list doesn't name.
2. **ABI vs ARCHITECTURE §2.** createInvoice, cancelInvoice, payInvoice, paySale, refund, setRelayFee, pause and unpause match §2 in name, argument types, order and return names. All five events match exactly (types, `indexed`, names). The nonce matches the §2 formula (`uint8 kind` pads to a word, same as viem's `uint8`). Deviations the spec records: constructor `(usdt, feeRecipient)`, pinned getter tuples, nine custom errors. **None of them breaks a consumer.** No lane constructs MerchantPay. The getters and errors are additions that viem decodes from the shared ABI. CapitalMarket's constructor arrives in Phase 3 along with the planned redeploy. §2 still says `MerchantPay(usdt)`, so claude-research needs to update it (tester INFO 4).
3. **Logic and edge cases.** Zero: amount 0 reverts on all three paths, and fee 0 skips the transfer (`fee != 0`), which the fuzz covers. Max: `MAX_FEE` is accepted, 250,001 reverts, and `gross - fee` can't underflow because `gross ≥ 1e6 > 250_000 ≥ fee`. Partial: refunds are cumulative and capped at gross, and invoices take exactly what is owed. Repeated calls: a second pay of an invoice gives `InvoiceNotOpen`, a second pay of an order gives `OrderPaid`, and a second refund past gross gives `RefundTooLarge`. Unknown ids revert (merchant `address(0)` never equals `msg.sender`). State and `Paid` are written before every token call. `relayFee` is read twice in one tx, and nothing can change it in between (the 1271 path is a staticcall). There is no division, so there's no rounding. The arithmetic is correct.
4. **Ponytail.** OZ `IERC3009`, `SafeERC20`, `SafeCast`, `Ownable`, `Pausable` and `ReentrancyGuardTransient` are reused, with no hand-written token interface. The contract is minimal. See findings 2 and 3 for the scripts and tests.
5. **Tests vs acceptance criteria.** M1, M2, M3, F1 and F5 are each asserted (see the tester's table, which I spot-checked against the code). One small gap: on the invoice path, "can't pay another amount" stops at MerchantPay's own `WrongAmount` and never reaches the token. The token's binding of `value` is shown on the sale path (`MerchantPay.t.sol:316`), so this is enough.

## Findings

**1. LOW, `contracts/src/MerchantPay.sol:159` (and `:186`). Owner: claude-contracts (Phase 3 redeploy); interim: claude-relayer.**
What: `paySale` accepts `merchant == address(this)`, and `setRelayFee` accepts `recipient == address(this)`. The tester confirmed the first one on the fork: 4.9 USDT is stranded, and `refund` returns `NotMerchant`.
Why: it breaks the literal NFR-2 rule "MerchantPay keeps no USDT", with no way to get the money back. It only happens if a payer signs MerchantPay as the merchant (a buggy or hostile integration). The second case is owner-only.
Fix: add `|| merchant == address(this)` to the `InvalidOrder` check and `|| recipient == address(this)` to the `ZeroAddress` check, with one test each. Ship it in the Phase 3 MerchantPay redeploy, which already replaces this contract before G3. Add it to build-contracts.md OPEN or `notes/phase-2-contracts.md` now so it isn't lost. Until the redeploy, the relayer refuses `paySale` where merchant is MerchantPay (better: only relay for merchants that have a session).

**2. LOW, `contracts/script/export-abi.sh:17` and `:20`. Owner: claude-contracts (the next batch that touches this script, before the G3 freeze).**
What: (a) The ABI comes from `contracts/out/`, so a stale build makes `export-abi.sh && git diff --exit-code packages/shared` pass against old source. That is the exact drift the spec criterion is meant to catch. (b) `> packages/shared/merchantPay.ts` truncates the file before python runs. With no build output the script fails and leaves the shared file empty. I reproduced this in a scratch tree: `FileNotFoundError: contracts/out/MerchantPay.sol/MerchantPay.json`, file 18,598 → 0 bytes.
Why: Phase 3 changes the ABI. A lane that exports without rebuilding would publish the old ABI to two other lanes.
Fix (Ponytail rung 5, an installed tool): take the ABI from `forge inspect src/MerchantPay.sol:MerchantPay abi --json` (run in `contracts/`). It compiles when needed and gives the identical ABI (checked: 51/51 entries equal). Pass it to python on stdin or as a file argument. Write to a temp file and `mv` it into place so a failure can't truncate the committed file.

**3. LOW, `contracts/test/MerchantPayEdges.t.sol:35-75`. Owner: claude-contracts (when the file is next touched).**
What: this file repeats the USDT, HOLDER, FORK_BLOCK and RECEIVE_TYPEHASH constants, the setUp, and the signing helpers from `MerchantPay.t.sol:17-99`.
Why: two copies of the signing code can drift apart, and the signing code is what proves the nonce encoding the other lanes copy.
Fix: move the 5 tests and `ReenteringWallet` into `MerchantPay.t.sol` and reuse `_sign`/`_paySale`, or pull the shared parts into an abstract base with no `test_` functions. Don't make `MerchantPayEdgesForkTest is MerchantPayForkTest`: forge would run the 27 inherited tests a second time.

**4. INFO, `contracts/src/MerchantPay.sol:101` vs `:221`. No action this batch.**
`createInvoice` takes `uint128 amount`, but `Payment.gross` is `uint96`. An invoice above 2^96−1 units (7.9e22 USDT) can be created but never paid: `SafeCastOverflowedUintDowncast` fires before any token call, so no funds are at risk. This can't happen with the real USDT supply. If Phase 3 touches `createInvoice` anyway, a `> type(uint96).max → WrongAmount` check fails early, at creation instead of at payment.

**5. INFO, `packages/shared/merchantPay.ts`, as a viem interface: complete and correct for this spec.** The ABI (51 entries, including all inherited OZ errors and events, so viem decodes `EnforcedPause`, `OwnableUnauthorizedAccount`, etc.), addresses, chainId, KIND_*, MIN_PAYMENT/MAX_FEE as bigint, the EIP-712 domain and types, and the nonce parameter list all typecheck under viem 2.57.13 strict and match the live contract. Consumers get two things elsewhere, both outside the spec: USDT `approve` before a merchant's first refund (viem's `erc20Abi`), and USDT `authorizationState` for the relayer pre-check (the relayer already inlines it). There's no `package.json`, so lanes import the file by path once it merges to main. That fits the spec's one-file decision.
Question for claude-frontend before the Phase 3 redeploy (G3 freezes the ABI): if `/pay/[invoiceId]` needs invoice → paymentId (FR-PAY-9 refund status) without reading `Paid` logs from Blockscout, ask for it now. The pinned `invoices()` tuple doesn't carry it.

**6. INFO, spec "Files to touch". Owner: claude-contracts (record only).**
The diff also changes `contracts/foundry.toml` (`via_ir`, a decision the spec records), `contracts/test/MerchantPayEdges.t.sol` (tester-added, committed in 3c3d85a) and `contracts/broadcast/{Deploy,Smoke}MerchantPay.s.sol/1874/run-latest.json` (the deployment records the Live criterion reads). Each one traces to a spec criterion, so this isn't scope creep. List them in the notes so the file list matches the diff.

## DONE
- Reviewed every changed file in the batch diff in full. ABI and events match ARCHITECTURE §2. The shared TS file typechecks against viem, and its nonces and domain match the live contract. MerchantPay tests 32/32 at HEAD, with fmt and lint clean.

## OPEN
- Finding 1 (Phase 3 redeploy + relayer interim guard), finding 2 (export script, before G3), finding 3 (test duplication), finding 5 question (invoice → paymentId).

## NEEDS THE USER
- None new from code review. The spec's three items still stand (fee recipient, "an order is paid once", PIPELINE §11 money-moving contract live and permissionless).
