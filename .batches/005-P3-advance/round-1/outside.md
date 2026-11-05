Outside opinion (not a verdict): Codex, `codex exec -s read-only --ephemeral`, 31,627 tokens, prompt `outside-prompt-005.txt` (src/ only). Commands: `rg --files contracts/src`, `nl -ba` on the four contracts and the interfaces. No .env access.

- No findings: fund loss/theft or a market-balance vs `totalOwed` deficit; `_distribute` rounding/overpay/dust/loops ("shares cannot exceed balances; the remainder loop is bounded by the eight-holder cap"); nonce/replay in `fundWithAuthorization` and MerchantPay; reentrancy (mint callbacks and settlement are guarded); ClaimToken batch/holder-cap/forced-transfer/frozen bypasses.
- **HIGH (admin trust, by design)** ClaimToken.sol:107–126, InvestorRegistry.sol:25–28: the owner (compliance admin = deployer EOA) can force-transfer claims between eligible holders, freeze balances and revoke eligibility. These are ERC-7943 compliance powers (SRS FR-TOK-5, FR-KYC-1). → disclose in the README limitations ("simulated KYC; the compliance admin can freeze or force-transfer, as regulated tokens require"); consider Ownable2Step on ClaimToken/InvestorRegistry (MerchantPay already has it) → for the human at the gate.
- **MEDIUM (admin trust)** MerchantPay.sol:203–234: owner can pause payments and sets the market once (a wrong address is permanent). Mitigated: the deployed wiring was checked on chain (G3 ran through it); README discloses the owner key.
- Not checked by Codex: tests, deployment, token implementation.

Action: no code change; admin-power disclosure and Ownable2Step for the two token contracts go to the human at the gate.
