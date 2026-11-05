VERDICT: PASS

Batch 006-P4-g4-live, round 2. Contracts only; no apps/ change, so web and relayer tsc/lint/build/tests are not affected and were not run. Run from /Users/vg890/ethglobal-contracts/contracts, Foundry at ~/.foundry/bin.

| # | Command | Exit | Output tail |
|---|---------|------|-------------|
| 1 | `forge build` | 0 | `No files changed, compilation skipped` |
| 2 | `forge fmt --check` | 0 | no output (clean) |
| 3 | `forge lint` | 0 | no output (no findings) |
| 4 | `forge test -j 1` | 0 | `Ran 11 test suites in 211.03s: 153 tests passed, 0 failed, 0 skipped (153 total tests)` |
| 5 | `forge coverage --ir-minimum -j 1 --report summary` | 0 (2nd run) | `Ran 11 test suites in 21.19s: 153 tests passed, 0 failed, 0 skipped (153 total tests)` |

Note on 5: the first coverage run exited 1. One fuzz test in CapitalMarketProbeForkTest failed after the fork RPC logged `sharedbackend: Failed to send/recv storage` (a fork RPC error, not a contract assert). I reran the same command once with no code change and it passed 153/153. Plain `forge test -j 1` passed on its own. The fork RPC is flaky under coverage load, and the fuzz test is worth watching.

## Coverage, src/ (NFR-10)

| File | Lines | Statements | Branches | Funcs |
|------|-------|-----------|----------|-------|
| src/CapitalMarket.sol | 100.00% (144/144) | 100.00% (228/228) | 100.00% (40/40) | 100.00% (17/17) |
| src/ClaimToken.sol | 99.07% (107/108) | 99.36% (155/156) | 100.00% (26/26) | 100.00% (25/25) |
| src/InvestorRegistry.sol | 100.00% (7/7) | 100.00% (6/6) | 100.00% (1/1) | 100.00% (3/3) |
| src/MerchantPay.sol | 97.78% (88/90) | 98.33% (118/120) | 100.00% (25/25) | 100.00% (16/16) |
| src/PullStub.sol | 100.00% (7/7) | 100.00% (5/5) | 0.00% (0/2) | 100.00% (2/2) |

All src/ files are at or above 80% lines. The branch figure for PullStub (0/2) is the only gap. It is the test stub, so I'm not blocking on it. The 75.53% Total line includes script/ files (Live*, Deploy*, Smoke*, RelayPull at 0% because they are broadcast scripts, not unit-tested) and test/ helpers. Seed.s.sol is 100% lines, 82.35% branches.

## Secret scan (item 3)

- `git diff --cached --name-only`: empty (nothing staged).
- Scope: `git diff 3495cd4 -- contracts .batches/006-P4-g4-live notes` plus the untracked batch folder and notes (1371 lines).
- Patterns checked: PEM private key blocks, `sk-`, `AKIA`, `ghp_`, `xox[bp]-`, and key/secret/mnemonic/password/private_key assignments with 16+ char values. 0 matches.
- 64-hex values: 205 in the diff. These are in broadcast JSON (tx hashes, block hashes, topics, r/s, logsBloom) and in source or notes as event selectors (EventAbi.t.sol lines 48 and 50) and tx hashes (notes, build-contracts.md). I found none that looks like a private key.
- `.env` files: only `.env.example` is tracked or untracked-visible. `.env` and `contracts/.env` are git-ignored (.gitignore:29).
- I never read .env, never printed env values and never ran forge script.
