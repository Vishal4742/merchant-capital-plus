# Contracts lane: build prep (research only, 2026-11-05 ~20:15 IST)

Scope: facts the contracts lane needs before Thu 21:00. No product code. Probes and downloads live in
`/private/tmp/claude-501/-Users-vg890-ethglobal/c228f97f-b195-421b-9239-2d869ad69e8e/scratchpad/contracts-prep/`
(`dl-erc/` EIP text + reference impl, `dl-oz/oz570/` OZ clone, `probes/` scratch Foundry project).
Chain probes ran against `https://rpc.ankr.com/whitechain_testnet` (chain id 1874, client `reth/v2.3.0-9384bc5`), block ~12,293,400.

## TL;DR
- ERC-7943 is **Final** (ERCs commit `46745bdc`, 2026-05-05). Multi-token interface id **`0x41c4fbad`** (recomputed with `cast sig` XOR, matches the EIP and ARCHITECTURE §2).
- OpenZeppelin: GitHub "Latest" release is **v5.7.0** (2026-07-29, commit `cab19933`). npm `latest` dist-tag still says **5.6.1** (5.7.0 sits under `dev`). Use the git tag: `forge install OpenZeppelin/openzeppelin-contracts@tag=v5.7.0`. `ERC1155._update(address,address,uint256[] memory,uint256[] memory) internal virtual` is unchanged; `ReentrancyGuardTransient` exists.
- Chain 1874 runs **PUSH0, MCOPY, TSTORE/TLOAD** (Cancun) and has Prague features (BLS precompile, EIP-2935, `requestsHash`). **Osaka is NOT active** (CLZ -> `NotActivated`). **Foundry 1.8.6 defaults to `evm_version = "osaka"`**, so `evm_version = "prague"` must be set explicitly in foundry.toml.
- Blockscout verification works: `--verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/`, no API key. Explorer lists solc up to 0.8.38 and evm `prague`; a Foundry `prague` contract was verified there today.
- Gas: USDT `transfer` = **61,748** (new recipient) / **44,201** (existing holder). Base fee 5 gwei, tip 0.001 gwei, L1 data fee ~6k wei (negligible). About 0.0003 WBT per plain transfer.
- Blocker found: none. Watch-out: `binaries.soliditylang.org` returned HTTP 500 for solc 0.8.35 and 0.8.37 today; 0.8.36 and 0.8.38 downloaded fine. Pin `solc_version = "0.8.38"` and pre-install it before 21:00.

## 1. ERC-7943 (uRWA)

Source: `curl https://raw.githubusercontent.com/ethereum/ERCs/master/ERCS/erc-7943.md` (saved to `scratchpad/contracts-prep/dl-erc/erc-7943.md`, 37,920 bytes).
Latest commit on that file: `46745bdc97a8bb246f03d3f4b7c5c4963c7573ff` 2026-05-05 "Update ERC-7943: Move to Final" (GitHub API `repos/ethereum/ERCs/commits?path=ERCS/erc-7943.md`). Header: `status: Final`, `requires: 165`.

### `IERC7943MultiToken is IERC165` (the ERC-1155 variant)
```solidity
event ForcedTransfer(address indexed from, address indexed to, uint256 indexed tokenId, uint256 amount);
event Frozen(address indexed account, uint256 indexed tokenId, uint256 amount);

error ERC7943CannotSend(address account);
error ERC7943CannotReceive(address account);
error ERC7943CannotTransfer(address from, address to, uint256 tokenId, uint256 amount);
error ERC7943InsufficientUnfrozenBalance(address account, uint256 tokenId, uint256 amount, uint256 unfrozen);

function forcedTransfer(address from, address to, uint256 tokenId, uint256 amount) external returns (bool result);
function setFrozenTokens(address account, uint256 tokenId, uint256 amount) external returns (bool result);
function canSend(address account) external view returns (bool allowed);
function canReceive(address account) external view returns (bool allowed);
function getFrozenTokens(address account, uint256 tokenId) external view returns (uint256 amount);
function canTransfer(address from, address to, uint256 tokenId, uint256 amount) external view returns (bool allowed);
```

Selectors and topics (computed with `cast sig` / `cast keccak`):

| Item | Value |
|---|---|
| `forcedTransfer(address,address,uint256,uint256)` | `0x18d308d0` |
| `setFrozenTokens(address,uint256,uint256)` | `0xbd456f5c` |
| `canSend(address)` | `0x2bc06a92` |
| `canReceive(address)` | `0x90d370ba` |
| `getFrozenTokens(address,uint256)` | `0xff6e708c` |
| `canTransfer(address,address,uint256,uint256)` | `0xa02ff685` |
| **interfaceId (XOR of the six)** | **`0x41c4fbad`** (EIP: "0x41c4fbad for the multi token interface") |
| Fungible / NonFungible ids (for reference) | `0x3edbb4c4` / `0xbf1ef5fe` (both recomputed, match EIP) |
| topic `ForcedTransfer(address,address,uint256,uint256)` | `0xa7f01abbf5b7ec7bac7fb74feb5c1f54af9e430f18a33681c1b9149875339a45` |
| topic `Frozen(address,uint256,uint256)` | `0x7b0c29e799ed468266b4d070c03070137a95cb869c5eb7c18063fb7b1a7a09c5` |
| `ERC7943CannotSend` / `CannotReceive` | `0x45bae9e2` / `0x705c1eed` |
| `ERC7943CannotTransfer` / `InsufficientUnfrozenBalance` | `0x869d0e66` / `0x7ce5d37b` |

`supportsInterface` must return true for `0x41c4fbad` (plus ERC-1155 `0xd9b67a26` and ERC-165 via OZ `super`).

### Rules from the spec that touch our `_update` design (ARCHITECTURE §2)
- `canSend`/`canReceive`/`canTransfer`: MUST NOT revert, MUST NOT write storage. `canSend`/`canReceive` are account-level only (no amounts, no token id). Wrapping `registry.isEligible` fits, but the registry call must not revert either (EAS decode path in Phase 5: wrap in try/catch or keep it a pure read).
- `canTransfer` MUST check `amount <= balance - frozen`, MUST call `canSend(from)` and `canReceive(to)`, and MUST return false if any *permissioned* rule would block (our `claimFrozen[id]`, `lockFrom[id]`, partial freeze). It MUST NOT return false for plain balance/allowance reasons. The 8-holder cap is a token rule that blocks the transfer, so include it in `canTransfer` too to keep the view honest.
- Public transfers MUST NOT succeed where `canTransfer`/`canSend`/`canReceive` would say false.
- Permissioned mint (market): SHOULD respect `canReceive`; MAY bypass.
- Permissioned burn (market, "burn never blocked"): MAY skip `canSend` and MAY burn above the unfrozen amount, **but then MUST lower the frozen amount and emit `Frozen` before the ERC-1155 transfer event**. Our payout burns hit this when compliance has frozen part of a holder's units.
- `forcedTransfer`: restricted access; MUST emit the base `TransferSingle` and `ForcedTransfer`; MAY bypass `canTransfer` in a single-party permissioned context, in which case it MUST unfreeze first and emit `Frozen` before the transfer event; SHOULD still check `canReceive(to)`; MUST revert when validations fail.
- `setFrozenTokens`: MUST emit `Frozen`, MUST allow freezing more than the balance, overwrites (not delta).
- Errors are optional ("MAY be used"); specific errors SHOULD win (`ERC7943InsufficientUnfrozenBalance` over a generic one; base `ERC1155InsufficientBalance` when amount > whole balance).

### Reference implementation
In the same repo: `assets/erc-7943/contracts/uRWA1155.sol` (+ `uRWA20.sol`, `uRWA721.sol`, `interfaces/IERC7943.sol`, `mocks/`). Last commit on uRWA1155.sol `75d4ec1b` 2026-03-20. Saved to `scratchpad/contracts-prep/dl-erc/uRWA1155.sol`. Built on OZ `ERC1155` + `AccessControlEnumerable`, `pragma ^0.8.29`, "not audited". Pattern worth copying: `_update` override branches transfer/mint/burn; `_excessFrozenUpdate` lowers frozen on burn/force; `forcedTransfer` calls `super._update` then `ERC1155Utils.checkOnERC1155Received` by hand, then emits `ForcedTransfer`.
Gotcha for us: if `forcedTransfer` calls `super._update` (as the reference does), it skips our own `_update` override, so the holder-list / 8-holder bookkeeping would not run. Put holder tracking in a helper both paths call, or route forced moves through our `_update` with a bypass flag.

OpenZeppelin also ships the interface: `openzeppelin-community-contracts/contracts/interfaces/IERC7943.sol` (last commit 2026-07-26), identical signatures to the Final EIP; community repo only has `ERC20uRWA`, no 1155 version. OZ main repo v5.7.0 has no 7943 file (`grep -rl 7943 contracts` empty). Simplest: copy the 30-line `IERC7943MultiToken` interface into our repo (CC0).

## 2. OpenZeppelin Contracts

| Check | Result |
|---|---|
| `npm view @openzeppelin/contracts version` | `5.6.1`; dist-tags `{latest: 5.6.1, dev: 5.7.0}`; 5.7.0 published to npm 2026-07-29 |
| `gh release list -R OpenZeppelin/openzeppelin-contracts` | `v5.7.0` marked **Latest**, not pre-release, 2026-07-29, target `cab19933c33c2ad1d4c7a84864a3601dddfd16f3`; `gh api .../releases/latest` -> `v5.7.0` |
| ERC1155 `_update` (v5.7.0 and v5.6.1, line 137) | `function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal virtual` |
| ERC1155Supply `_update` (v5.7.0) | `function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal virtual override` (calls `super` first, then totals) |
| `_updateWithAcceptanceCheck` | two overloads in 5.7.0: `(from,to,ids,values,data)` and `(from,to,ids,values,data,bool batch)`; OZ says override `_update`, not these |
| `ReentrancyGuardTransient` | present in v5.7.0 and v5.6.1 (`contracts/utils/ReentrancyGuardTransient.sol`, `pragma ^0.8.24`, modifiers `nonReentrant`, `nonReentrantView`) |
| pragma | ERC1155/ERC1155Supply/ReentrancyGuardTransient `^0.8.24`; OZ's own foundry.toml uses solc 0.8.31 + osaka (their test setup only) |

Install, pinned (Foundry 1.8.6 `forge install --help`: `@tag=` gives exact match; install no longer commits unless `--commit`):
```
forge install OpenZeppelin/openzeppelin-contracts@tag=v5.7.0
```
Remapping: `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`.

5.6/5.7 changes that matter to us (release notes):
- 5.7.0 breaking: `EIP712` drops the storage fallback; `name` and `version` must each fit in 31 bytes or the constructor reverts. "MerchantPay"/"1" are fine.
- 5.6.0: batch transfer with exactly one id now calls `onERC1155BatchReceived`, not `onERC1155Received`. Any receiver contract (or test mock) must implement both.
- 5.6.0: `ERC1155._checkAuthorized` added; setting operator `address(0)` now reverts.
- If anyone prefers npm-`latest` parity, `v5.6.1` has the same `_update` and `ReentrancyGuardTransient`; the only difference we would feel is the EIP712 rule above.

End-to-end check: a scratch contract `Probe is ERC1155Supply, ReentrancyGuardTransient` (constructor runs a `nonReentrant` mint through an overridden `_update`) compiled against OZ v5.7.0 with solc 0.8.38, `evm_version = "prague"`, then `cast call --create <bytecode>` on 1874 returned 8,851 bytes of runtime code (no revert); `cast estimate --create` = 2,155,063 gas.

## 3. EVM features on chain 1874

Raw init-code probes with `cast call --rpc-url https://rpc.ankr.com/whitechain_testnet --create <hex>`:

| Probe | Bytecode | Result |
|---|---|---|
| PUSH0 (Shanghai) | `0x602a5f5260205ff3` | returns `...2a` OK |
| MCOPY (Cancun, EIP-5656) | `0x602a6000526020600060205e60206020f3` | returns `...2a` OK |
| TSTORE+TLOAD (Cancun, EIP-1153) | `0x602a60015d60015c60005260206000f3` | returns `...2a` OK |
| BLOBBASEFEE (Cancun) | `0x4a60005260206000f3` | returns `1` OK |
| CLZ (Osaka, EIP-7939) | `0x60011e60005260206000f3` | **`EVM error: NotActivated`** |
| control `INVALID` | `0xfe` | `InvalidFEOpcode` (probe method sane) |

Prague evidence: BLS12-381 G1ADD precompile `0x0b` returns 128 zero bytes for two infinity points (exists); EIP-2935 history contract `0x0000F90827F1C53a10cb7A02335B175320002935` has 83 bytes of code; block header carries `requestsHash` (EIP-7685). GasPriceOracle `0x42..0F`: `isIsthmus() = true`, `isFjord() = true`.

Conclusion: `evm_version = "prague"` is safe (cancun also safe). **Do not leave the Foundry default: `forge config --json` on Foundry 1.8.6 reports `evm_version: "osaka"`**, and Osaka opcodes revert here. Set in foundry.toml:
```toml
evm_version = "prague"
solc_version = "0.8.38"
```

Latest block (`cast block latest`, block 12,293,407, 2026-11-05 14:42:55 UTC):
- `gasLimit` **40,000,000**
- `baseFeePerGas` **5,000,000,000** (5 gwei; `cast base-fee` = 5e9)
- `cast gas-price` 5,001,000,000; `eth_maxPriorityFeePerGas` 0xf4240 = 0.001 gwei
- `blobGasUsed` 0, `excessBlobGas` 0

## 4. Contract verification (Blockscout)

API checks (all HTTP 200, behind Cloudflare but plain curl works):
- `GET https://explorer.testnet.whitechain.io/api?module=block&action=eth_block_number` -> `{"result":"0xbb95b3"}` (matches chain head)
- `GET /api/v2/stats`, `/api/v2/config/backend-version` (`sha-6a61a03a9f`) respond
- `GET /api?module=contract&action=checkverifystatus&guid=0x00..00` -> `{"message":"OK","result":"Unknown UID","status":"1"}` (Etherscan-style verify API is live)
- `GET /api/v2/smart-contracts/verification/config`: methods include `standard-input`, `multi-part`, `flattened-code`; solc list tops out at `v0.8.38+commit.1835d247`; evm versions include `prague` and `osaka`
- 382 verified contracts, 12 verified in the last 24 h. Example verified today: `PaymentRouter` `0x9f38D33010345DCd62e26640b539263FA139026E`, solc 0.8.28, `evm_version: prague`, `file_path: src/PaymentRouter.sol` (a Foundry layout), `is_fully_verified: true`

Forge round trip: `forge verify-contract 0x000000000000000000000000000000000000dEaD src/Probe.sol:Probe --chain 1874 --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ --rpc-url https://rpc.ankr.com/whitechain_testnet` submitted and got Blockscout's own answer "Address is not a smart-contract", so the submit path, URL and missing API key are all accepted. A real successful verification of *our* bytecode is **UNVERIFIED** until the first deploy (expected to work given the PaymentRouter example).

Working flags:
```bash
# verify an existing deployment
forge verify-contract <ADDR> src/ClaimToken.sol:ClaimToken \
  --chain 1874 --rpc-url https://rpc.ankr.com/whitechain_testnet \
  --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/ \
  --constructor-args $(cast abi-encode "constructor(address,address,uint64)" <registry> <admin> 60) --watch

# deploy + verify (Foundry 1.x: without --broadcast, forge create does not send)
forge create src/InvestorRegistry.sol:InvestorRegistry --rpc-url https://rpc.ankr.com/whitechain_testnet \
  --account <keystore-name> --broadcast \
  --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/
```
`forge script ... --broadcast --verify --verifier blockscout --verifier-url https://explorer.testnet.whitechain.io/api/` takes the same flags (from `forge create --help` / `forge verify-contract --help`; the script variant is UNVERIFIED on this explorer). No `--verifier-api-key` needed.

## 5. Gas baseline for the relayer

Holder found via `GET /api/v2/tokens/0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7/holders`: EOA `0xFfD76ff981cc7EA15EE2F67680815763C4C7683E` (589,653.13 USDT, `balanceOf` confirmed with cast). Token: Tether USD, 6 dp, 81 holders.

| Call (`cast estimate --from 0xFfD7…683E`) | Gas |
|---|---|
| `transfer(0x1111…1111, 1e6)` new recipient (zero -> nonzero slot) | **61,748** |
| `transfer(0xA161…bF7, 1e6)` existing holder | **44,201** |
| `transferWithAuthorization` (ARCHITECTURE §7, earlier probe) | ~84,400 |

L1 data fee (OP Stack): `GasPriceOracle.getL1FeeUpperBound(200)` = 5,835 wei, `(600)` = 16,362 wei; `getOperatorFee(100000)` = 0. Effectively zero next to L2 execution.

Budget at 5.001 gwei: plain transfer 0.000309 WBT (~3,200 per WBT); transferWithAuthorization 0.000422 WBT (~2,370 per WBT); a 200k-gas `payInvoice` (UNVERIFIED guess: auth pull + fee transfer + `onPayment` pushes to up to 8 holders) ≈ 0.001 WBT (~1,000 per WBT). So 1 testnet WBT covers the whole demo with a wide margin. Explorer shows mainnet WBT at $76.67, so in production a 200k-gas relay costs about $0.077, under the 0.10 USDT relay fee; heavy multi-holder payouts could pass it (UNVERIFIED until we measure `forge test --gas-report`).
