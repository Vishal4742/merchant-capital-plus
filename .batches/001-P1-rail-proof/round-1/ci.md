VERDICT: PASS

Batch 001-P1-rail-proof, round 1. Worktree /Users/vg890/ethglobal-contracts, HEAD a443d9f. Nothing staged (`git diff --cached --name-only` is empty).

## 1. Contracts (cwd contracts/)
| Command | Exit | Output tail |
|---|---|---|
| `forge build` | 0 | `No files changed, compilation skipped` (cache clean) |
| `forge test` | 0 | `Ran 1 test suite: 7 tests passed, 0 failed, 0 skipped (7 total)`, all `[PASS]` in PullStubForkTest (fork of Whitechain 1874, ~7 s) |
| `forge coverage --report summary` | 0 | see table |
| `forge fmt --check` | 0 | no output (clean) |

Coverage:
```
| File                   | % Lines        | % Statements  | % Branches    | % Funcs       |
| script/RelayPull.s.sol | 17.65% (3/17)  | 16.67% (4/24) | 0.00% (0/2)   | 50.00% (1/2)  |
| src/PullStub.sol       | 100.00% (7/7)  | 100.00% (5/5) | 100.00% (2/2) | 100.00% (2/2) |
| Total                  | 41.67% (10/24) | 31.03% (9/29) | 50.00% (2/4)  | 75.00% (3/4)  |
```
Note (not a failure): the only contract, src/PullStub.sol, is 100%. The total is dragged down by the broadcast-only script, which tests do not run by design.

## 2. Apps
Not applicable. The batch touched only contracts/ (plus .gitmodules); nothing under apps/ changed.

## 3. Secret scan
Pattern `(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})` over `git diff --name-only d22cc48..HEAD` (minus the two submodule gitlinks contracts/lib/forge-std and contracts/lib/openzeppelin-contracts), plus notes/phase-1-contracts.md and everything under .batches/001-P1-rail-proof/.

- `PRIVATE_KEY` hits are variable NAMES only: contracts/script/RelayPull.s.sol:29-31 (`vm.envUint("DEPLOYER_/RELAYER_/PAYER_PRIVATE_KEY")`), plus prose in notes, spec.md, batch.md, build-contracts.md, review-security.md. No key value anywhere. No `SECRET` value.
- 64-hex hits, classified:
  - Tx hashes: 0x162fe5c8...dbc95 (deploy), 0xc4629df1...c847e (relayed pull), 0x9f5efc75...ee000, 0x86efc97b...af27a, 0x8a9d5049...a49 (public chain data, in notes, batch.md, build-contracts.md, test.md, run-latest.json `hash`/`transactionHash`).
  - blockHash values (0xb63011d3..., 0x6eed8985...) in run-latest.json.
  - Log topics in run-latest.json: event signature hashes (0x98de5035... AuthorizationUsed, 0xddf252ad... Transfer), address-padded topics (payer 0xE53f..., token, relayer 0xb4E7...), and the EIP-3009 nonce.
  - run-latest.json lines 38,40,41: the call args of the relayed pull, a bytes32 nonce and the signature r and s. These are public on-chain calldata of a mined tx for a single-use authorization (already consumed), not key material.
  - logsBloom, `input` calldata and `data` fields: zero-padded ABI data (amount 0xf4240 = 1 USDT).
  - run-latest.json:147 `recovery_generation`: Foundry bookkeeping hash, not a secret.
- No private key, mnemonic or API key found.
- `git check-ignore -v .env` -> `.gitignore:29:.env	.env` (exit 0, ignored).
- `git ls-files | grep -c '^\.env$'` -> `0` (not tracked).
- I did not read or print .env.
