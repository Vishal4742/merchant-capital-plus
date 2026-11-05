# WHITECHAIN_FEEDBACK.md

Honest notes from building Merchant Capital+ on Whitechain Sepolia (chain 1874). Whitechain asked for this file ("a few honest lines on what worked, where you got stuck and what our docs were missing") and called it "extremely important" at the workshop. Everything below was verified on-chain or with live tooling on the date given.

## Brief → build map (keep honest; a row is done only with a demo moment and a README link)
| Track requirement (official wording, shortened) | SRS | Demo moment | Status |
|---|---|---|---|
| Contracts deployed and verified on Whitechain Sepolia | SR-WC-1 | Explorer pages of the four contracts | not started |
| ≥1 USDT payment in the main flow, explorer link in the README | SR-WC-2 | AT-1 shop sale tx | not started |
| Operate: drop-in piece a separate demo app adds in about 20 lines; merchant + customer views | SR-OP-1 | `apps/shop` integration, lines counted | not started |
| Operate (v2.0): payment links, pages, invoices, QR, a one-line button + SDK, vouchers, multi-currency, reports, settlements | SR-OP-1/2, FR-GW-1–12 | AT-11–AT-15 | in progress (Phase 4) |
| Operate extra credit: past the first payment (refund, export) | SR-OP-2 | AT-2 refund, CSV export | not started |
| Scale: payer with zero crypto steps; who pays gas, how the relayer gets WBT, what stops draining | SR-SC-1/2 | Checkout with no WBT; relayer `/health` + drain guard | not started |
| Tokenize: real transfer rules in the contract; issuer + investor roles; one full lifecycle step | SR-TK-1/2 | AT-3/4/5 advance; AT-8 blocked transfer | not started |

## What worked
- **2026-10-25:** the public RPC answered `eth_chainId`, block and `eth_call` queries fast; Foundry `cast` worked against 1874 with zero special config. The explorer is Blockscout, which we expected `forge verify-contract --verifier blockscout` to plug straight into; on build day it didn't (friction 12), but its standard-input API gave a full match.
- **2026-10-25 / 11-05:** the official test USDT `0xcedf…55a7` supports EIP-2612 `permit` **and** EIP-3009 (`transferWithAuthorization`, `receiveWithAuthorization` that enforces payee == caller, `validAfter` "auth early" checks). That is what makes gasless checkout and pre-signed due-date payments possible.
- **2026-11-05:** the P-256 precompile (`0x…0100`) verifies a real passkey signature on testnet and mainnet; EAS is predeployed at `0x4200…0021`; Multicall3, Permit2, CreateX and Safe are at their canonical addresses.
- **2026-11-05:** the workshop and the venue one-pager were clear and practical (2 WBT/day faucet, YetiTrade swap for USDT, the free Ankr RPC code, docs for AI agents at docs.whitechain.io/build-with-ai).
- **2026-11-05 (build):** the gasless path worked on the first live try: a payer with 0 WBT and nonce 0 paid through our relayer with `receiveWithAuthorization` (94,034 gas, ≈0.035 USDT of WBT). MerchantPay then split a 2 USDT sale into fee + merchant share in one 217k-gas transaction and refunded 1 USDT, both **fully verified** on Blockscout.
- **2026-11-05 (build):** 1 s blocks and a 5 gwei floor make a relayed pull cost about 3–4 US cents of WBT; the keyless Ankr endpoint is fast, has CORS `*`, and also works through the Nym mixnet (block reads with 0 direct requests). Foundry fork tests against the real USDT run in GitHub Actions through the public RPC with no key.

## Where we got stuck (friction)
1. **Getting test USDT wasn't documented on Oct 25** (the faucet drips WBT only). By Nov 5 the answer is "swap WBT on YetiTrade", which works, but the docs' token list page still describes v1.1.0 without the prize USDT while the official token list v3.0.0 includes it.
2. **Two testnets share the name** (chain 2625 "Whitechain Testnet" vs 1874 "Whitechain Sepolia"); search results and Chainlist pages mix them.
3. **`eth_getLogs` range caps:** keyless Ankr rejects ranges over ~1,000–3,000 blocks; the official RPC caps at 10,000. With 1 s blocks a dashboard can't scan history, so we read state through Multicall and history from Blockscout instead.
4. **No `debug_traceCall`** on either public RPC, so standard ERC-4337 bundlers can't run safely; no public bundler or paymaster service supports 1874.
5. **No price oracle on testnet** (Chainlink, Pyth, RedStone absent; one third-party feed was stale since Oct 29), so fees are priced from the YetiTrade pool.
6. **The public RPC is behind Cloudflare,** which can challenge privacy-network (Tor) traffic; the Ankr endpoint works through Anon-RPC.
7. **Mainnet status is stated three ways** (homepage "shipped", FAQ "testnet only", prize page "planned for November"), and official USD₮ on mainnet is "in later releases".
8. *(Oct 25)* The USDT contract was hard to identify on the explorer; its dispatcher looked like old Tether while behaving like OpenZeppelin.
9. *(Nov 5, build)* **Foundry's default EVM target doesn't run on 1874.** Foundry 1.8.6 defaults to `osaka`; on 1874 the Osaka opcode CLZ fails with `NotActivated`, while Prague features (PUSH0, MCOPY, TSTORE, BLS, EIP-2935) work. Nothing in the docs says which hardfork the chain runs, so we probed it with `cast call --create`. A line "Whitechain Sepolia runs Prague; set `evm_version = \"prague\"`" in the developer docs would save every Foundry team this probe.
10. *(Nov 5, build)* **viem's built-in `whitechainSepolia` points at the Cloudflare-fronted RPC,** so wallets and SDKs that use the chain's default RPC (Privy, viem) inherit the Cloudflare endpoint unless each app overrides it. We pass the Ankr URL explicitly.
11. *(Nov 5)* **Faucet limits are per wallet, per IP and per GitHub account, 2 WBT a day.** One faucet claim swaps to about 149 test USDT, so a demo with realistic invoice sizes (10,000 USDT) is impossible for a team; we divided every demo amount by 10. A testnet USDT faucet, or a builder grant of test USDT at the booth, would let teams show real-sized invoices.
12. *(Nov 5, contracts lane)* **`forge verify-contract --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` fails with "Missing solc version: 0.8.38"** (forge 1.8.6, also with `--compiler-version 0.8.38+commit.1835d247`), although the explorer lists that compiler. Workaround: `forge verify-contract … --show-standard-json-input`, then POST it as multipart to `/api/v2/smart-contracts/<addr>/verification/via/standard-input`.
13. *(Nov 5, contracts lane)* **Partial match only, from absolute paths in the metadata:** Foundry's auto-detected remappings (from OpenZeppelin's nested `remappings.txt`) put an absolute local path into the solc metadata, so Blockscout gave a partial match. Fix: `auto_detect_remappings = false` plus explicit relative remappings (commit `4f9c0b0`). A note on verifying Foundry projects in the developer docs would help.

## Suggestions
1. Document the test-USDT route (YetiTrade) on the faucet page, and update the token-list docs page to v3.
2. One canonical "Networks" page: 1874 vs 2625 vs mainnet 1875, with RPC, explorer, faucet, tokens and status.
3. Publish RPC limits (rate, `eth_getLogs` range) and whether trace methods are planned.
4. A recommended paymaster/bundler path, or a hosted relayer, for the Scale track.
5. An oracle on testnet before mainnet, since Tokenize projects need prices.

## Feedback log (sponsor interactions)
| When | Who / where | What they said | What we changed |
|---|---|---|---|
| 2026-11-05 16:30 | Workshop (Toma Sadova) | Build what business needs; B2B2C; Tokenize includes lending; judging is a 2–3 min booth pitch | Picked Merchant Capital+ (financing for merchants); pitch trimmed to 3 min |
