Outside opinion (not a verdict): Codex, `codex exec -s read-only --ephemeral`, 23:11–23:12, 26,661 tokens. Prompt: scratchpad `outside-prompt-002.txt` (MerchantPay.sol, its test, the deploy and smoke scripts, foundry.toml; no .env, no deploys). Its log shows only MCP auth errors from its own config and reads of the listed files; the only "env" hits are the scripts' `vm.envAddress`/`vm.envUint` lines and a NatSpec comment.

1. Funds: **low**, MerchantPay.sol:228 (`_collect`): USDT sent directly to the contract is stuck for good. Same as the Phase 1 sweep question; the code says so in a `ponytail:` comment. → decision for the human at the gate (accept, or add an owner-only sweep that can't touch in-flight funds; payments never hold a balance between txs).
2. Signatures and nonce: no findings (binds chain, contract, kind, invoice id or merchant + orderRef, amount, salt; a copied signature can only trigger that payment).
3. Access and pause: no findings.
4. Interactions and reentrancy: no findings (state + `Paid` before token calls, guard on pay and refund, ERC-1271 reached through the token).
5. Order squatting: no finding (a valid payer authorization bound to the merchant and order is required). Note: this reads squatting as "mark another's order paid without paying"; the plan review's case (a stranger pays a guessable orderRef with their own money first) stays covered by the random-orderRef + gross-check rule sent to the lanes.
6. Tests: **info**, MerchantPay.t.sol:73: only EOA signers; no ERC-1271 success/failure/reentry test, and no competing-submitter race test. → the round-1 tester was asked to probe a malicious ERC-1271 payer on the fork.

Action: none on the code yet; items 1 and 6 tracked above.
