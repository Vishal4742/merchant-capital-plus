VERDICT: PASS

No UI in this batch. I read spec.md (Interface) and apps/relayer/src/relayer.ts from the frontend's point of view. Nothing here blocks the pay page or the dashboard.

## For claude-frontend (notes, not blockers)
1. Status codes are enough for the three customer states:
   - 400 means a client bug, so show a generic "something went wrong, try again".
   - 422 means the payment can't go through: expired, already used, or not enough USDT. Show "payment couldn't be completed, nothing was charged".
   - 502 means a temporary failure, so offer retry. A 502 with `txHash` means the tx was mined and reverted: say "pending / contact merchant" and don't offer a blind retry.
   - 200 `{txHash, blockNumber}` is success. The explorer link is built by the UI from `txHash`.
2. The UI must never render the `error` string to the customer (FR-PAY-7, NFR-6). Strings such as "unknown action (Phase 1 supports "pull")", "sig must be 65 bytes of hex" and viem `shortMessage` text (which can name the contract function or the chain) are developer-facing. Map by status code only and keep `error` for logs and the merchant view. This is a frontend-lane rule, and the API shape allows it.
3. 422 has no machine-readable reason (expired, replay and low balance look the same). That is fine for the Phase 1 stub. For Phase 2, consider a stable `code` field such as `expired` or `insufficient` so the pay page can show a distinct empty or error state. Worth adding to the ARCHITECTURE §3 contract.
4. `/relay` waits for the receipt, up to 30 s. The pay page needs a visible pending state and a client timeout above 30 s. Without both, the customer sees a hang.
5. `/health` is enough for the "who pays gas" panel as a skeleton.
   - `relayer` and `wbt` are real.
   - `gasSpentToday`, `budgetLeft` and `usdtFeesUnswapped` are null until Phase 2, so the dashboard needs a "not available yet" state for them. Don't render "0" or "NaN".
   - `wbt` is a decimal string (e.g. "0.4993"), so format it in the UI. It is merchant-facing, so showing WBT there is allowed. The FR-PAY-7 ban applies only to the customer flow.
   - 502 `{error}` on health should show as "relayer unreachable".
