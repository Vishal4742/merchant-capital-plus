# Phase 2, contracts lane (claude-contracts)

## Batch 002-P2-merchantpay: MerchantPay
SRS FR-PAY-1/2/3/5/6/8, FR-REL-4/7/9, NFR-1/2, CON-2/3/4. Branch `contracts`.

**Built:** `src/MerchantPay.sol` (OZ v5.7.0 `IERC3009`, `SafeERC20`, `Ownable`, `Pausable`, `ReentrancyGuardTransient`); `test/MerchantPay.t.sol` (27 fork tests at pinned block 12,303,386); `script/DeployMerchantPay.s.sol`, `script/SmokeMerchantPay.s.sol`, `script/export-abi.sh`; `packages/shared/merchantPay.ts` (generated).

**Live:** MerchantPay `0x83b53Cc0a5A67fAd41bCc56e2ac40465Cf1573b7` (deploy `0x7364ac31…c51b`, from clean commit `2424138`), **fully** verified on Blockscout. Smoke: sale `0xae155c49…fb1a` (deployer-submitted, 217,194 gas), refund `0xbd91e67e…f939`; payer 0 WBT, nonce 0.

**Decisions:** kinds INVOICE=1 / SALE=2; nonce `keccak256(abi.encode(chainid, this, kind, ref, orderRef, amount, salt))`; an order is paid once (`saleOf`), so orderRef must be random and consumers compare `payments(saleOf).gross` with the session amount; invoices paid in full in Phase 2; `Paid` emitted before token calls; `via_ir = true` (10-arg `paySale` is stack-too-deep otherwise; coverage with `--ir-minimum`); fee recipient = relayer hot wallet (human 23:40: keep).

**Facts for later phases:**
- Pin fork tests to a block: Ankr serves historical state (checked 100k blocks back), runs are deterministic and cached.
- Blockscout needs a few seconds to index a new contract before `verification/via/standard-input` accepts it ("Address is not a smart-contract" = retry).
- Build signatures in tests from the documented formula, not the contract's view, so the token's signature check doubles as an encoding test.

**Round-1 findings to fix before G3 (all LOW/INFO, none blocking):** (1) `paySale` accepts `merchant == address(this)` and `setRelayFee` accepts `recipient == address(this)`: both strand USDT (tester + reviewer-code; one-line guards + a test each in the Phase 3 redeploy; claude-relayer refuses such sales meanwhile); (2) `export-abi.sh` empties the shared file if python fails (redirect before run) and reads a possibly stale `out/`: switch to `forge inspect src/MerchantPay.sol:MerchantPay abi --json` + temp file and `mv`; (3) `MerchantPayEdges.t.sol` duplicates the setup and helpers of `MerchantPay.t.sol`: merge or use an abstract base (not inheritance of the test contract, which reruns its 27 tests); (4) **human 23:40: add an owner-only sweep in Phase 3** for USDT sent directly (MerchantPay never holds funds between txs, so sweeping its balance can't touch a payment); (5) consider an invoice → paymentId lookup for FR-PAY-9 refund status (asked claude-frontend). (6) reviewer-security INFO for Phase 3: read `relayFee` once and pass it down (two reads break once `onPayment` sits between them); cap `createInvoice` amount at `type(uint96).max` (payments store uint96); use `Ownable2Step` (one-step owner = deployer EOA today); pause this MerchantPay when the Phase 3 one goes live so stale signatures can't pay its invoices.

**Phase 3 must ship the last MerchantPay** (plan review): CapitalMarket takes MerchantPay in its constructor and `ClaimToken.setMarket` is one-time. One redeploy adds `setMarket` + `onPayment` routing (decide transfer-then-call vs approve-and-pull; it sets routed gas and whether 0.10 covers it), the "not financed" check in `cancelInvoice`, partial `paid` (FR-INV-4), and the `acknowledge` field (FR-PAY-13). Measure routed gas then (ARCHITECTURE §9 item 2).

## Batch 003 draft: demo seed script (CON-8), waits for the human
- One forge script, deployer key only: sends fixed USDT amounts from the team wallet to the demo wallets; idempotent (tops up to a target, never above); prints a table; no faucet in the app.
- **Needs the human:** (1) the demo wallet addresses (merchant, investor A, investor B, debtor: the human's browser wallets; the customer is a guest wallet made in the browser, so the merchant's shop flow funds it or the script takes its address at demo time); (2) the float: AT-3–AT-7 at ÷10 need ≈ 1,100 USDT in circulation (advance 100, invoice ≈ 981, sales); AT-5 needs 550 USDT of sales at 20% holdback to reach the 110 cap unless sales recycle money. The team wallet holds ≈ 110 USDT now, so either more faucet → swap rounds or the ÷100 fallback (HANDOFF 19:56).
