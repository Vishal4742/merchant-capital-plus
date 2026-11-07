# SRS amendments for batch 050 (for claude-research or the human to apply to docs/SRS.md)

From the PR #44 review (whiteflow-ef) and the round-2 fixes. Lanes don't edit the SRS (PIPELINE.md §3).

1. **NFR-8 row (CSP):** say that `/sign-in` loads Privy (auth.privy.io), and that `/checkout` and `/pay` already allow Privy for the opt-in payer sheet (FR-PAY-16, batch 046). No other route's CSP allows Privy; `test/csp-privy-scope.test.mjs` checks this.
2. **FR-BIZ-4, step-up:** the Owner's approval is a purpose-bound EIP-4361 signature, valid ≤ 5 min, from an **enrolled approval wallet**.
   - The workspace's first activation pins its approval wallet.
   - Later wallets need an endorsement signed by an enrolled approval wallet of a current Owner.
   - Wallets linked to a sign-in later can't approve until endorsed.
   - Every Owner is notified of new links and enrollments.
   - Disclosed limit: a solo Owner who loses every approval wallet needs support to change the policy.
3. **FR-BIZ-6, recovery:** replace "recovery is Privy email login". Accounts may be wallet-only. Email recovery restores sign-in, but it can't change where a workspace is paid without an enrolled approval wallet (H1).
4. **CON-11:** obligations means `advanceOf(wallet) != 0` (covers `liensOf`), or an uncancelled, unsettled invoice claim of the wallet with units outstanding, the same rule as `CapitalMarket.hasClaimsOn`. Any failed read refuses (503), and so does an offer book larger than the server reads completely (200 offers on testnet; an indexer is needed beyond that).
5. **FR-AUTH-4:** receiving-policy activation takes an idempotency key. The same key returns the version it created; another payload under the same key gets 409.
6. **Changes/Status:** add a 3.1 entry with the real time of these changes.
