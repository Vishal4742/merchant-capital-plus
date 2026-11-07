# W1 — canonical message round-trip experiment (plan, not yet a batch)

Goal (WF§11 W1, DEP-8 proposed): prove on the **deployed** Ethereum Sepolia ↔ Whitechain Sepolia messengers that a zero-value application message goes L1→L2 and an outcome comes back L2→L1, with authenticated origin on both sides, correct handling of a failed inner relay, and measured timing — before any corridor contract (W6) is written. This is an experiment, not the payment path; nothing here moves stablecoins.

Starts when: SRS v3.0 approved (DEP-8 citable) · Foundry v1.8.6 + pinned libs installed · owner sets `SEPOLIA_RPC_URL`, `SEPOLIA_MESSENGER_PRIVATE_KEY` (Sepolia ETH), `WHITECHAIN_MESSENGER_PRIVATE_KEY` (test WBT), `WHITECHAIN_RPC_URL=https://rpc.testnet.whitechain.io` in `.env`.

## Facts already verified read-only (2026-11-06; see notes/phase-W0-baseline.md §5)
L1CDM `0x547967f45d19dc4ca0a056ba525afe99bda18a88` (v2.11.0) ↔ L2CDM `0x4200…0007` (v2.2.0), paired both ways, unpaused · CGT mode on → value must be 0 both ways · `failedMessages`/`successfulMessages` getters exist on both · Portal `0xff9b…d0c3`, DGF `0xfaa2…c833`, permissioned game type 1, proposer live · proof maturity 900 s, dispute finality 300 s · public L2 RPC keeps ~17–28 h of proof state.

## Contracts (experiment only; `contracts/src/experiments/`, never referenced by product code)
- `W1Receiver` (deployed on both chains, constructor `(messenger, expectedRemoteSender)`; the remote sender is set once after both deploy, then locked):
  - `receive(bytes32 id, bytes payload)` — requires `msg.sender == messenger` **and** `ICrossDomainMessenger(messenger).xDomainMessageSender() == remote`; records `(id, payload hash, block.number, block.timestamp)` once; reverts on duplicate id; optional `failMode` flag (owner-set before the test) that reverts to simulate a failed inner call.
  - `send(bytes32 id, bytes payload, uint32 minGasLimit)` — calls `messenger.sendMessage(remote, abi.encodeCall(receive,(id,payload)), minGasLimit)` with **zero value**.
- Unit/fork tests (local fork of both chains): forged caller rejected; right messenger + wrong `xDomainMessageSender` rejected; duplicate id rejected; value > 0 path absent.

## Live steps and pass criteria
| # | Step | Pass evidence |
|---|---|---|
| 1 | Deploy `W1Receiver` on 1874 (L2) and on Sepolia (L1); link remotes | 4 tx hashes; verified source on both explorers |
| 2 | L1 `send(id1)` → wait for L2 relay | L1 tx hash; L2 relay tx hash; `received[id1]` set; measured L1-inclusion→L2-execution latency |
| 3 | Forged L2 call (EOA → `receive`) and wrong-sender relay | Both revert (tx hashes or `eth_call` reverts) |
| 4 | Failed inner relay: set `failMode`, L1 `send(id2)` | L2 relay succeeds as an outer tx but `failedMessages[hash]=true`, `received[id2]` unset (proves outer success ≠ application success) |
| 5 | Replay: clear `failMode`, anyone calls `L2CDM.relayMessage(...)` with the original params, value 0 | `received[id2]` set once; `successfulMessages[hash]=true`; a second replay reverts |
| 6 | L2 `send(id3)` back to L1; wait for a covering dispute game; `proveWithdrawal`; wait ≥ 900 s; `finalizeWithdrawal` (viem op-stack actions, `whitechainSepolia`) | prove + finalize tx hashes; L1 `received[id3]` set; measured L2-inclusion→finalize latency |
| 7 | Failed callback inside a successful finalize (failMode on L1) then L1 replay | finalize tx succeeds, L1 `failedMessages[hash]=true`; replay sets state once |

Record for every step: chain, tx hash, block, timestamp, gas used, and cost (Sepolia ETH / WBT). Timing is reported as observed samples, never as a promise.

## Decision outputs (go/no-go for W6/W7)
- Go only if steps 2–7 pass. Any failure → corridor stays disabled, direct-only release continues, blocker recorded with evidence.
- Economics note: measured reimbursement delay D (testnet ~1–3 h; mainnet ≥ 7 days per docs) feeds the working-capital bound `V × D + B` (WF§7); no production numbers are inferred from testnet.
- Trust note: permissioned dispute game + guardian/upgrade roles remain operational assumptions; the finality gate is a policy, not a cryptographic proof (WF§7 step 4).
