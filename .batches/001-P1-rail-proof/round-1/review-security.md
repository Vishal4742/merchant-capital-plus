VERDICT: PASS

# Security review: 001-P1-rail-proof, round 1 (reviewer-security, 2026-11-05 21:43 IST)

Repo: `/Users/vg890/ethglobal-contracts` (worktree, branch `contracts`, HEAD `a443d9f`; working tree clean for `contracts/` and `.gitmodules`). Diff: `git diff d22cc48..HEAD -- contracts .gitmodules` (10 files; the two `contracts/lib/*` gitlinks checked by pin only). Read: PIPELINE.md, spec.md, batch.md, build-contracts.md, round-1/test.md, round-1/outside.md, ARCHITECTURE.md §1–§3 and §7. Chain checks were read-only (`cast` and JSON-RPC to https://rpc.ankr.com/whitechain_testnet, chain id 1874; Blockscout v2 API). I sent no transaction, ran no `forge script`, used no key, did not open `.env` or the `.env` symlink, and edited no code.

**Result:** no CRITICAL, HIGH or MEDIUM finding. PullStub has no state and no admin, and it forwards exactly what it pulls to an immutable, non-zero payee. The token itself enforces DEP-1: I checked this in the token's verified source as well as the fork tests. The committed broadcast file holds no secret. What remains is residual risk from a live, permanent, permissionless stub, plus notes for Phase 2.

## 1. Mandated secret grep

Run on the 8 regular files of the diff (the 2 gitlinks are pinned third-party trees; `--include` quoted because zsh globs it):
```
grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' '--include=*' .gitmodules contracts/.gitignore contracts/broadcast/RelayPull.s.sol/1874/run-latest.json contracts/foundry.lock contracts/foundry.toml contracts/script/RelayPull.s.sol contracts/src/PullStub.sol contracts/test/PullStub.t.sol
```

| Hit | What it is | Verdict |
|---|---|---|
| `contracts/script/RelayPull.s.sol:29,30,31` | the names `DEPLOYER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`, `PAYER_PRIVATE_KEY` inside `vm.envUint(...)`; no values | clean |
| `contracts/broadcast/RelayPull.s.sol/1874/run-latest.json`, 31 lines (4, 19, 27, 38, 40, 41, 48, 62, 63, 65, 82–84, 87, 90, 98–100, 102, 103, 106, 114–116, 118, 119, 122, 128, 129, 131, 147) | 18 distinct hex values of at least 32 bytes. A script fetched both txs, both receipts and both blocks from the RPC. Each tx's recorded `input` equals its on-chain input byte for byte, and 17 of the 18 values appear verbatim in that on-chain data: 2 tx hashes, 2 block hashes, the EIP-3009 nonce `0x4a7c…`, the signature's r `0xbb11…` and s `0x2445…`, 2 event topic0s, 4 padded address/amount words, 2 logs blooms, the initcode and the pull calldata | clean (public) |
| same file `:147` `recovery_generation` | the one value that is not on chain. forge here is 1.8.6 at commit `6bad0a66`, which sets it with `let generation = B256::random(); data.set_recovery_generation(generation);` (foundry-rs/foundry@6bad0a66 `crates/script/src/recovery.rs:130` and `:169`). It only ties the broadcast file to its cache twin (`crates/script-sequence/src/sequence.rs:29-35`, `:246`) | clean (random id, not key material) |

No `PRIVATE_KEY` or `SECRET` values. Extra checks:
- **Files this batch will also commit** (`.batches/001-P1-rail-proof/*`, `notes/phase-1-contracts.md`): the hits are env var names in prose (batch.md:8, spec.md:5, spec.md:37, notes/phase-1-contracts.md:24) and five tx hashes (`0x162f…`, `0x86ef…`, `0x8a9d…`, `0x9f5e…`, `0xc462…`). I confirmed each hash on chain with `eth_getTransactionByHash`. Clean.
- **Ignore rules** (`git check-ignore -v`): `.env` (root .gitignore:2, :29), `.env.*` (:3), `contracts/out/` (:22), and `contracts/cache/` (:23), where Foundry writes the only sensitive script field, the RPC URL. Dry runs are ignored at contracts/.gitignore:2, timestamped runs at :3, locks at :4. `git ls-files contracts/broadcast contracts/cache contracts/out .env` returns only the one `run-latest.json`.
- **Key logging:** Foundry 1.8.6 redacts `vm.addr`, `vm.broadcast(uint256)` and `vm.sign` inputs as `<pk>`, and every `env*` cheatcode output as `<env var value>` (`crates/evm/traces/src/decoder/mod.rs:1273-1334`, `:1455` @6bad0a66). RelayPull's keys therefore stay out of traces at any verbosity. The script has no `console.log`.

## 2. Checklist

| Area | Result | Evidence |
|---|---|---|
| Who can call | PASS | `pull` is permissionless by design (ARCHITECTURE §1, last line). No owner, admin function, proxy or selfdestruct; the only state is two immutables (PullStub.sol:34-35) |
| EIP-3009 binding | PASS for a stub | `to` is fixed to `address(this)` (PullStub.sol:53). Both receive overloads go through EIP3009.sol:130 `require(to == msg.sender)` (TetherTokenV2.sol:296, :356; verified implementation `0x2642…26f7`). The digest uses the token's own typehash and domain separator (RelayPull.s.sol:15-18). No invoice/order binding: out of scope (FR-PAY-6), see S2 |
| receive vs transfer | PASS | PullStub.sol:53 calls `receiveWithAuthorization`. The two typehashes differ (EIP3009.sol:35, :37), and PullStub.t.sol:105 shows a receive signature fails on `transferWithAuthorization` |
| CEI / reentrancy | PASS | No storage to update. The only external calls go to the immutable token, and its `_transfer` has no recipient hook: TetherToken.sol:47-57 checks only the blocklist and `to != token` |
| Conservation (in == out, no fee) | PASS | Forwards exactly `value` (PullStub.sol:54). No relay fee by design (FR-REL-4). The token has no transfer fee. If an upgrade ever added one, `safeTransfer` would revert (the stub holds 0) and the pull would fail atomically |
| Stuck / claimable by others | PASS (S3) | The payee is immutable and non-zero (PullStub.sol:38, test :113), and nobody else can receive from the stub. The live stub holds 0 USDT and 0 WBT (cast). Stray deposits can't be recovered (S3) |
| mint/burn, transfer rules, rounding, default/recourse | N/A | No claim token, market or financing maths in this batch |
| Deployed code = reviewed code | PASS | The on-chain runtime (805 bytes) matches `out/PullStub.sol/PullStub.json` at HEAD once immutables are masked and CBOR stripped. The on-chain immutables are USDT `0xcedf…55a7` and the team wallet `0xb4E7…714D`. Only the metadata hash differs (build OPEN 1) |
| Token trust | accepted (CON-2) | USDT is an EIP-1967 proxy. Its implementation slot points to `0x2642…26f7` (TetherTokenV2, Blockscout full match, solc 0.8.4) and its admin slot to `0xb8d4…4042`. The admin can upgrade the token, and its owner can block addresses (WithBlockedList.sol). Blocking the stub would make every pull revert; no funds are lost |
| Relayer stub (forge script): allowlist | PASS | One hard-coded target and selector (RelayPull.s.sol:44) |
| simulate before send | PASS | forge simulates the whole script before it broadcasts |
| fee inside the tx, 1 USDT minimum | out of scope | FR-REL-4 (Phase 2). S1 covers what this leaves open |
| gas caps | not set, accepted | Limits come from forge's estimate (deploy `0x49336`, pull `0x21934`), which is fine for one manual run. The Phase 2 relayer must cap gas (ARCHITECTURE §3 guard 5) |
| signature window | PASS | 15 min (RelayPull.s.sol:26, :38), matching guard 6 |
| rate limits, daily budget | N/A | One-off script |
| key never logged | PASS | §1 |
| Web: secrets in bundles, webhook HMAC, trackers | N/A | No web code in this batch |
| PII on chain / Arkiv | PASS | The stub stores and emits nothing. Tx data holds only addresses and amounts of throwaway wallets |
| Supply chain | PASS | Gitlink `cab19933c33c2ad1d4c7a84864a3601dddfd16f3` equals upstream `refs/tags/v5.7.0`, and gitlink `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` equals upstream `refs/tags/v1.17.0` (`git ls-remote`). Both checkouts are clean, with `origin` set to the official GitHub repos (.gitmodules:1-6). `foundry.lock` records the same revs. With `auto_detect_remappings = false` and two relative remappings (foundry.toml:12-16), only those two trees compile in. No `ffi`, no `fs_permissions`, no `[etherscan]` key, and the RPC URL carries no key (foundry.toml:19) |

## 3. Findings (none blocking)

### S1 · LOW (residual, cross-lane) · relayer gas drain through the permanent stub with 1-unit pulls
- **Where:** `contracts/src/PullStub.sol:43-55` (no minimum, permissionless, can't be switched off), together with the relayer lane's `/Users/vg890/ethglobal-relayer/apps/relayer/src/relayer.ts:81` (rejects only `value == 0`) and `apps/relayer/api/relay.ts:5` (target fixed to this stub).
- **Exploit sketch:** the attacker funds one EOA with about 0.0011 USDT, signs about 1,060 `ReceiveWithAuthorization(to = stub, value = 1 unit, fresh nonce)`, and posts each one to `/relay`. Every simulation passes, so the relayer sends each pull at 91–94k gas, about 0.00047 WBT. The hot wallet's 0.498 WBT is gone after roughly 1,060–1,090 requests. The attacker's 0.001 USDT lands in our own team wallet, so the amplification is about 35,000×. Every later gate demo then stalls until the faucet refills (2 WBT/day).
- **Exposure today: none found.** The dev server binds 127.0.0.1 (apps/relayer/dev.ts:29). There is no `.vercel/` or `vercel.json`, and nothing listens on :8787. The relayer spec keeps it local "until the Phase 2 guards land" (relayer `.batches/001-P1-relay-stub/spec.md:50`). However, `api/relay.ts` is already a deployable Vercel function, and ARCHITECTURE §6 says the Vercel projects deploy on push.
- **Fix:** nothing to change in this batch, since the stub is deployed and immutable. claude-relayer keeps `/relay` local until FR-REL-4 (1 USDT minimum, fee inside the tx) and the FR-REL-5/6 rate limits and daily budget land, and removes the stub from its targets when MerchantPay ships. The human confirms that no Vercel Git integration points at `apps/relayer` before then.
- **Owner:** claude-relayer (human for Vercel).

### S2 · INFO · any authorization naming the stub can be redeemed by anyone, at any time, and always pays the team wallet
- **Where:** PullStub.sol:53 (caller-chosen nonce, no invoice binding) and PullStub.sol:31-56 (no owner, no pause).
- **Sketch:** anyone who sees an unexpired `ReceiveWithAuthorization(to = 0x51e2…325d)`, whether in a mempool, a log or a dry-run file, can submit it. The money still goes to `payee`. The worst case is griefing: the relayer's own copy then reverts and wastes its gas. The one real case is closed. The dry-run's authorization named the live stub because the deployer's nonce was unchanged. Its `validBefore` was 21:20:01 IST, and it is now expired and unused (`authorizationState` false). I checked both dry-run files.
- **Phase 2 consequence:** the stub stays live forever. If any client config still names it after MerchantPay lands, customer payments go to the team wallet with no payment record.
- **Fix:** MerchantPay delivers FR-PAY-6 (nonce recomputed on chain, ARCHITECTURE §2). When MerchantPay deploys, remove the stub address from every config (today: relayer `api/relay.ts:5`).
- **Owner:** claude-contracts (MerchantPay), claude-relayer, claude-frontend.

### S3 · INFO · no sweep: stray USDT stays in the stub forever
- **Where:** PullStub.sol:31-56. The natspec "Nothing is kept here" (PullStub.sol:29) holds only for `pull`.
- **Sketch:** funds can get in two ways: a plain `transfer` to the stub, or a `TransferWithAuthorization` (the wrong primaryType) signed with `to = stub`. Anyone can submit the second straight to the token, because `transferWithAuthorization` has no caller check (TetherTokenV2.sol:179, :237). Nobody can take the funds out, the payee included. The balance today is 0.
- **Fix:** none for the stub. MerchantPay should sweep any balance above what it owes, or record a decision not to. Every signer (guest wallet, relayer, scripts) must use primaryType `ReceiveWithAuthorization` only, and test M1 (ARCHITECTURE §2) should cover the wrong-type case.
- **Owner:** claude-contracts, claude-frontend.

### S4 · INFO · the token checks payers that have code with ERC-1271, not ecrecover (Phase 2 pre-check)
- **Where:** in the token implementation, `util/SignatureChecker.sol` sends any `from` with `extcodesize > 0` to `isValidSignature` and everything else to `ECRecover`. It is reached from EIP3009.sol:214-221.
- **Sketch:** if EIP-7702 delegation is active on 1874 (Prague includes it), a delegated EOA's authorization is judged by its delegate's `isValidSignature`, not by its key. An off-chain pre-check that uses plain ecrecover (ARCHITECTURE §3 guard 3) would wrongly accept or reject such payers. This is not exploitable against us, because simulation still decides (relayer.ts:102).
- **Fix:** in Phase 2, treat simulation as the authority, or mirror the token's branch in the pre-check.
- **Owner:** claude-relayer, claude-contracts.

### S5 · INFO · three committed files are outside spec.md's file list
- `contracts/.gitignore`, `contracts/foundry.lock` and `contracts/broadcast/RelayPull.s.sol/1874/run-latest.json`. All three are clean (§1) and reasonable to commit; whether they're in scope is reviewer-code's call. **Owner:** claude-contracts.

## DONE
- Ran the secret grep on the diff's 8 regular files and the batch markdown and notes. Every hit is an env var name, a public on-chain value, or Foundry's random `recovery_generation` (§1).
- Reviewed PullStub.sol:31-56 and RelayPull.s.sol:1-46 against the token's verified source (TetherTokenV2 + EIP3009 + SignatureChecker, Blockscout full match). DEP-1, conservation and reentrancy all pass (§2).
- Confirmed the live stub `0x51e2…325d` is the reviewed code: same runtime, immutables are USDT and the team wallet, balance 0, payer 0 WBT and nonce 0.
- Checked the submodule pins against upstream tags.
- Confirmed the dry-run authorization naming the live stub is expired and unused.
- The tester's two tests are committed (a443d9f), which closes test.md OPEN 1.

## OPEN
- S1–S5 above; none blocks this batch. S1 must be closed before `apps/relayer` is reachable from outside 127.0.0.1.

## NEEDS THE USER
1. **PIPELINE §11 flags:**
   - PullStub moves money. It is live, permissionless and permanent: there is no owner or pause, so it can't be switched off, but it can only ever pay `0xb4E7…714D`.
   - RelayPull holds three `.env` keys in one process (RelayPull.s.sol:29-31).
   - New dependencies: OZ v5.7.0 and forge-std v1.17.0.

   Security sees no blocker; you still sign off.
2. **Vercel (S1):** confirm that no Vercel project with Git auto-deploy points at `apps/relayer` until the Phase 2 relayer guards (FR-REL-2..6) and the 1 USDT minimum are in.
