# Spec: 011-P4-web-network-fee

Request (verbatim): "do it" (human, 07:39), answering "a merchant-only 'network fee we covered' column on the Payments or Settlements page … to show judges that the shop paid for gas, not the customer. Say yes if you want it." Phase mode (PIPELINE §3b): build + ci. Money: no (read-only chain reads, display only).

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-PAY-3 / FR-REL (gasless): the merchant sees, per payment, the network fee the relayer paid for that transaction, plus a total. This is proof that the customer paid none.
- FR-PAY-7: merchant pages only. The customer receipt and checkout keep "You paid no network fee", with no fee figure or WBT.
- FR-PAY-8: on /merchant/payments, receipt links point to the checkout's receipt (/r/<session id>). Today they link the payment number, which the receipt page doesn't know.

## Acceptance criteria
- [ ] `readTxFee(txHash)` (lib/onchain.ts) = receipt.gasUsed × receipt.effectiveGasPrice, in wei, with the same retry as the other reads. A failure shows "—", never a guess.
- [ ] /merchant/payments gets a "Network fee" column (a cell on phones), e.g. "0.000021 WBT", and a line above the list: "Your customers paid no network fee. We covered X WBT across N payments." Payments whose fee couldn't be read are left out of the total, and the line says so.
- [ ] PaymentRow gets a `receiptId`: the session id for our own checkouts, null for rows only the log index knows. The Receipt cell links /r/<receiptId> or shows "—".
- [ ] Tests: the fee maths (gasUsed × effectiveGasPrice), the WBT formatting (6 dp, no exponent), receiptId on session and log rows.
- [ ] typecheck, lint, `npm test`, build; a screenshot of /merchant/payments.

## Files (claude-frontend)
- `apps/web/lib/onchain.ts`
- `apps/web/lib/dashboard.ts`
- `apps/web/app/merchant/payments/page.tsx`
- `apps/web/test/dashboard.test.mjs`
- `apps/web/test/onchain-fee.test.mjs` (new)
