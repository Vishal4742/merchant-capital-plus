VERDICT: PASS

# Security review: 002-P2-merchantpay, round 1 (reviewer-security)

Scope: `git diff 44772c7..HEAD -- contracts packages` (f885e37 RED, a67d260 GREEN, 2424138 scripts, 099bb97 deploy records + `packages/shared/merchantPay.ts`, 3c3d85a tester edge tests). Worktree `/Users/vg890/ethglobal-contracts`, HEAD 3c3d85a. Read: PIPELINE.md, spec.md, batch.md, build-contracts.md, ARCHITECTURE.md §2–§3, round-1/test.md, round-1/outside.md. Live checks were read-only `cast call`/`cast storage` against https://rpc.ankr.com/whitechain_testnet. I used no key, ran no broadcast, read no `.env`, and edited no code.

No CRITICAL, HIGH or MEDIUM findings. Two LOW and six INFO, below. Neither LOW lets anyone take funds. Both need a redeploy to fix, and Phase 3 must redeploy before G3 anyway, so they go there. The interim guards belong to the relayer and frontend lanes.

## Findings

| # | Sev | Where | Exploit sketch | Fix | Owner |
|---|---|---|---|---|---|
| S1 | LOW | `contracts/src/MerchantPay.sol:159` (also `:186`) | A buggy or hostile integration builds a sale nonce with `merchant = MerchantPay`. The payer signs it and anyone submits. `gross − fee` stays in MerchantPay for good: no sweep, and `refund` would need `msg.sender == MerchantPay` (tester fork probe: 4.9 of 5 USDT stranded, `refund` → `NotMerchant`). Nobody can claim the money, so this is a burn, not theft. It breaks the literal NFR-2 "MerchantPay keeps no USDT". `setRelayFee(fee, address(this))` strands fees the same way, but only the owner can do that. | Add `\|\| merchant == address(this)` to the `InvalidOrder` check and `recipient == address(this)` to the `setRelayFee` check, each with a test. Ship it in the Phase 3 redeploy. Until then, the relayer refuses `merchant ∈ {0, MerchantPay, USDT}` and the shop never builds that sale. | claude-contracts (code), claude-relayer + claude-frontend (interim guard) |
| S2 | LOW | `contracts/src/MerchantPay.sol:228` | USDT sent by a plain `transfer` is stuck: there's no sweep. Outside's item 1 found the same, and the code marks it with a `ponytail:` comment. Payments never hold a balance between transactions (live `balanceOf(MerchantPay)` = 0 now). | Accept it as designed, or add an owner-only sweep in Phase 3. It's safe because the contract never holds funds between transactions. This is the human's call at the gate. | human / claude-contracts |
| S3 | INFO | `contracts/src/MerchantPay.sol:222`, `:242` | `relayFee` is read twice: once for the `Paid` event, once for the actual transfer. Today the reads always match, because the only callback inside a payment is the token's ERC-1271 `staticcall`, which can't write state. Phase 3 adds an external `CapitalMarket.onPayment` call between record and collect, and then the logged fee and the charged fee could differ. | Read the fee once in `payInvoice`/`paySale` and pass it to `_record` and `_collect`. Phase 3 redeploy. | claude-contracts |
| S4 | INFO | `contracts/src/MerchantPay.sol:39,105` vs `:45,221` | Invoices store `uint128 amount`, but payments store `uint96 gross` (`SafeCast.toUint96`). `createInvoice` accepts amounts that `payInvoice` can never pay. Today that's only self-DoS. In Phase 3, a listed invoice that can't be paid through MerchantPay leaves its investors with only the recourse lien. | `if (amount > type(uint96).max) revert WrongAmount();` in `createInvoice`. Phase 3 redeploy. | claude-contracts |
| S5 | INFO | `contracts/src/MerchantPay.sol:19,92` | The owner is the deployer EOA, which also signs the scripts and is the smoke-test merchant. Ownership is single-step `Ownable`, so a wrong `transferOwnership`, or `renounceOwnership` while paused, blocks payments forever (refunds keep working). If the deployer key leaks, an attacker can pause payments and point the fee at themselves, up to `MAX_FEE` 0.25 USDT per payment. The cap bounds the loss. | Phase 3: `Ownable2Step`, and think about a separate owner key. Listed under NEEDS THE USER. | claude-contracts / human |
| S6 | INFO | consumers of `packages/shared/merchantPay.ts` | Duties for the lanes wiring to the live contract now: **(a)** After an identical-payload front-run, the relayer's tx reverts `OrderPaid`/`InvoiceNotOpen`. Treat that as paid only if `payments(saleOf(m, ref))` has `gross == amount && payer == from`. A mismatched gross means squatting (tester OPEN 3): start a new session. **(b)** Allowlist only target `0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7` with selectors `paySale 0x96d2584e` and `payInvoice 0xcdb71426`. The merchant sends `refund 0x5af36e3e` itself; never relay it. Keep drain guard 11 (reject payers with code): the tester measured 37.4M gas burned inside `isValidSignature`. **(c)** The wallet prompt shows the nonce as opaque bytes, so the payer can't see which merchant they're paying. Any script on `/checkout` or `/pay` can swap the nonce and pay an attacker's merchant through MerchantPay. So: no third-party scripts or trackers on those pages, a strict CSP, show the merchant and amount, and check the nonce against `saleNonce`/`invoiceNonce`. `/pay/[invoiceId]` must show the invoice's **on-chain** merchant, because anyone can create an invoice with any `customer`/`refHash`. **(d)** `refHash` goes on chain in `InvoiceCreated`. A keccak of a low-entropy reference (the tests use `keccak256("INV-001")`, `test/MerchantPay.t.sol:103`) or of an email or name can be brute-forced, which puts PII on chain. Use the keccak of a random 32-byte id. | As described in each item. | claude-relayer (a, b), claude-frontend (a, c, d) |
| S7 | INFO | Phase 3 | After the redeploy, this contract stays live and permissionless. Pre-signed authorizations (for example `/schedule` with `validAfter = dueDate`) can still pay its invoices directly, outside the market's routing. | When the Phase 3 MerchantPay goes live, `pause()` this one (refunds stay open) and remove its address from `packages/shared`. | claude-contracts |
| S8 | INFO | `contracts/test/MerchantPay.t.sol:269` | ARCHITECTURE §2 M1 says "direct `transferWithAuthorization` can't bypass". No test replays the Receive signature as a `transferWithAuthorization`. The property holds, because the typehashes differ (live `TRANSFER_WITH_AUTHORIZATION_TYPEHASH()` 0x7c7c6cdb… and `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()` 0xd099cc98… both equal the canonical keccaks). | Optional: a one-call test that expects `TetherToken: invalid signature`. | claude-contracts |

## Checklist (contracts)
| Check | Result | Evidence |
|---|---|---|
| Who can call each function | OK | `createInvoice`: anyone, merchant = `msg.sender` (:109) · `cancelInvoice`: only that invoice's merchant; an unknown id has merchant 0, so it gives `NotMerchant` (:115) · `payInvoice`/`paySale`: anyone (FR-REL-7), `nonReentrant whenNotPaused` (:134, :158) · `refund`: only that payment's merchant (:173), also while paused · `setRelayFee`/`pause`/`unpause`: `onlyOwner` · no `receive`/`fallback` |
| EIP-3009 nonce binding | OK | Nonce = keccak(chainid, this, kind, id or merchant, orderRef, amount, salt) (:202–210). The token binds `from`, `to`, `value` and the time window. Invoice ids are never reused and `id → merchant` never changes. With fixed-width `abi.encode`, a sale nonce can't collide with an invoice nonce. Another deployment gives a different nonce and `to`. Fork tests: other id, merchant, orderRef, amount or salt → `invalid signature` |
| receive vs transfer | OK | `receiveWithAuthorization` (:241). The token requires `to == msg.sender` (`test/MerchantPay.t.sol:269`). The typehashes are distinct on the live token (S8) |
| Checks-effects-interactions / reentrancy | OK | `_record` writes state and emits `Paid` before the pull (:141–142, :162–164). `refund` writes state and the event before `transferFrom` (:177–179). `nonReentrant` on all three money paths. The only callback is the token's ERC-1271 `staticcall` (tester probe: the guard trips first, and the staticcall blocks it on its own). Tether has no transfer hooks |
| `Σ = gross` | OK | `fee + (gross − fee)`. `gross ≥ 1e6 > MAX_FEE ≥ fee`, so there's no underflow, and invoices enforce the minimum at creation (:105). Fuzz F1 (256 runs). Live sale: 2,000,000 = 100,000 + 1,900,000 |
| No USDT stuck or claimable by others | OK, except S1/S2 | Live `balanceOf(MerchantPay)` = 0 (read now). Nothing anyone can claim |
| Rounding | N/A | This contract does no division |
| Mint/burn by market, transfer rules, default/recourse | N/A | Phase 3 (ClaimToken, CapitalMarket) |
| Live state (read now) | OK | owner `0xb4E7…714D`, `paused` false, `relayFee` 100000 → `0xdd02…a651`, `paymentCount` 1, `invoiceCount` 0. USDT is a transparent proxy (impl `0x2642…26f7`, admin `0xb8d4…4042`). An upgrade could add hooks, and `nonReentrant` already covers that case |
| Pins | OK | `contracts/lib` is unchanged in this diff. OZ `package.json` says 5.7.0 (`git describe` v4.8.0-1217 is just the nearest fetched tag). forge-std v1.17.0 |

## Relayer and web
- No relayer or web code in this batch. S6 lists what the relayer and frontend must do with this contract.
- `packages/shared/merchantPay.ts` is safe to import from client code: an ABI, public addresses, constants. No URLs, keys or tokens, and no imports.
- PII on chain: `customer` (an address, informational) and `refHash`. See S6(d). No Arkiv in this batch.

## Secret check
`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 10 files in the diff (values masked when shown): **91 hit lines, no secrets.**
| File | Hits | What they are |
|---|---|---|
| `contracts/script/DeployMerchantPay.s.sol:17` | 1 | env var **name** `vm.envUint("DEPLOYER_PRIVATE_KEY")` |
| `contracts/script/SmokeMerchantPay.s.sol:24,25` | 2 | env var **names** `DEPLOYER_PRIVATE_KEY`, `PAYER_PRIVATE_KEY` |
| `contracts/broadcast/DeployMerchantPay.s.sol/1874/run-latest.json` | 15 | Classified by JSON path: block hashes, tx hashes, log topics/data, logsBloom, the creation calldata, and `recovery_generation` |
| `contracts/broadcast/SmokeMerchantPay.s.sol/1874/run-latest.json` | 73 | Same kinds, plus 4 `paySale` `arguments` (orderRef, salt, r, s). All 4 are byte-for-byte in that tx's public calldata |
| `foundry.toml`, `export-abi.sh`, `MerchantPay.sol`, both tests, `merchantPay.ts` | 0 | Test keys come from `makeAddrAndKey` |

- `recovery_generation` (one per record, different in each file, found nowhere else) is forge's `B256::random()` resume id (foundry `crates/script/src/recovery.rs`, `set_recovery_generation(B256::random())`). It isn't a key.
- Every transaction in both records is `from` the deployer `0xb4e7…714d`. No `/Users/` path appears in either record or in the shared file.
- Scripts: keys are read only through `vm.envUint`, and nothing is printed with `console.log`. Forge traces redact env-cheatcode output (`<env var value>`) and the key arguments of `sign`/`addr`/`broadcast` (`<pk>`) (foundry `crates/evm/traces/src/decoder/mod.rs`, `decode_cheatcode_outputs`). RPC URLs go to `contracts/cache/`, which is git-ignored. `.env` and `.env.*` are git-ignored; only `.env.example` is tracked.

## DONE
- `contracts/src/MerchantPay.sol` reviewed line by line against the checklist above; live state read on 1874; secret grep run with every hit classified.

## OPEN
- S1–S8 above. The Phase 3 redeploy should fix S1, S3, S4 and S5 in the code and pause this contract (S7). S6 goes to the relayer and frontend lanes now.

## NEEDS THE USER
1. PIPELINE §11: a money-moving, permissionless contract is live on 1874. The deployer key is its only owner (pause, fee up to 0.25 USDT, fee recipient).
2. Fee recipient = the relayer hot wallet `0xdd02…a651`: if that key leaks, the attacker also gets the unswapped USDT fees. Confirm, or move it with `setRelayFee`.
3. S1: fix now (redeploy, re-verify, new address for both lanes) or in Phase 3's planned redeploy, with the relayer guard in the meantime. Recommended: Phase 3.
4. S2: no sweep, accept or add one in Phase 3.
