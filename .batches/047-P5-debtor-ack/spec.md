# Spec: 047-P5-debtor-ack (the debtor acknowledges an invoice; investors see it)

## Requirements (cite docs/SRS.md IDs)
- **FR-INV-8 (new; claude-research adds it to docs/SRS.md):** the debtor can acknowledge an invoice with a signed
  message; investors see it. Priority S, phase 5. The coordinator's brief named it FR-INV-6, but the SRS already uses
  FR-INV-6 (the cut freeze-and-recourse rule, human 00:34), so this batch uses the next free ID, FR-INV-8.
- FR-INV-1, FR-INV-3: the invoice a merchant lists and investors fund now carries "Debtor acknowledged" or "Not
  acknowledged yet" in the offer book, so an investor can see whether the payer accepts the debt before funding.
- FR-ARK-4: no debtor data on Arkiv. The ack lives only in our database (app_gw_invoice_acks); the mcplus.offer.v1
  entity is unchanged (no debtor address, no signature).
- FR-PAY-3, FR-PAY-16: the same three ways in as paying (this browser's guest key, the browser wallet, Privy if its
  app ID is set) sign the acknowledgement; it is `eth_signTypedData_v4` / a local EIP-712 signature, never a transaction.
- FR-PAY-7: the default path's words stay plain ("You confirm you owe this invoice. This doesn't pay it and moves no
  money."); only the wallet buttons (data-pay-option="wallet") say "wallet".
- FR-PRIV-1: the pay page still makes no browser chain reads (the server reads the invoice and verifies).

## Design
- EIP-712 domain `{name: "Merchant Capital+", version: "1", chainId: 1874, verifyingContract: CapitalMarket}`
  (packages/shared `capitalMarket`). Type `InvoiceAck(uint256 invoiceId, address merchant, uint256 amount, uint64
  dueDate, address debtor)`; amount is the invoice's face in USDT base units, dueDate unix seconds. One module
  (lib/invoice-ack.ts) builds it for the browser and the server.
- POST /api/v1/invoices/:id/acknowledge `{debtor, signature}`: rate limited per IP (10/min, like the other public
  routes), our shop's invoices only, open invoices only (paid 409, cancelled 410, missing 404), the merchant can't
  acknowledge its own invoice (400). The server rebuilds the message from the invoice it reads on chain (never from the
  browser) and checks it with viem `verifyTypedData` against `debtor`.
- Table app_gw_invoice_acks (db/051_invoice_acks.sql): `(merchant_pay, invoice_id)` primary key (invoice ids restart
  on a MerchantPay redeploy, code review 005 F9), debtor, signature, signed_at (unix ms, when our server accepted it).
  `INSERT … ON CONFLICT DO NOTHING`: the first valid ack wins; the same debtor again is a no-op (200, the stored
  time); another debtor gets 409.
- GET /api/v1/capital/offers: every offer gains `debtor_acknowledged` (boolean) and `debtor_ack`
  (`{debtor: "0x1234…abcd", signed_at}` or null): the short address only, never the signature. Read in offerBook (the
  one path the offers route, the merchant route and the merchant Capital page share); a failed read logs and shows
  "Not acknowledged yet".

## Acceptance criteria (each must be checkable)
- [ ] test/invoice-ack.test.mjs (PGlite, chain reads faked): valid ack 200 + stored; wrong signer, tampered amount,
      wrong chain → 400 and nothing stored; same debtor twice → one row, same time; another debtor → 409; the
      merchant's own key → 400; paid/cancelled/other shop's invoice refused; the 11th call in a minute → 429.
- [ ] offerBook: an invoice offer with an ack → `debtor_acknowledged: true` and the short debtor; without → false/null;
      the Arkiv terms carry no debtor key (FR-ARK-4).
- [ ] UI states (source pins, like test/wallet-pay-sheet): the pay page shows the action only for an open invoice
      with no ack, the copy, guest + wallet + Privy ways in, endWalletSession after every attempt; the offer book,
      My live offers and the merchant's invoice list show "Debtor acknowledged ✓" or "Not acknowledged yet".
- [ ] `npm run typecheck && npm run lint && npm test && npm run build` pass in apps/web.

## Files to touch (owner lane: only these)
- apps/web/db/051_invoice_acks.sql (new)
- apps/web/lib/invoice-ack.ts (new), apps/web/lib/server/invoice-acks.ts (new)
- apps/web/app/api/v1/invoices/[id]/acknowledge/route.ts (new)
- apps/web/lib/sign-sale.ts (signAck; Payer signs any typed data)
- apps/web/components/InvoiceAck.tsx (new), apps/web/components/DebtorAck.tsx (new)
- apps/web/components/InvoicePay.tsx, apps/web/app/pay/[invoiceId]/page.tsx, apps/web/components/WalletPay.tsx
  (export the connect step without the funds check)
- apps/web/lib/server/capital.ts (offerJson fields), apps/web/lib/server/capital-arkiv.ts (offerBook joins acks)
- apps/web/components/capital/investor/OfferBook.tsx, apps/web/components/capital/merchant/MyOffers.tsx,
  apps/web/components/merchant/Invoices.tsx, apps/web/app/merchant/page.tsx
- apps/web/test/invoice-ack.test.mjs (new), apps/web/test/capital-core.test.mjs (the offerJson shape)

## Ponytail ladder (why this is the smallest change that works)
- Needed: yes, the README limitation investors hit. Already in repo: viem typed data + verifyTypedData, the guest
  key / browser wallet / Privy connect, the db helper + PGlite tests, rateLimit, offerBook. No new dependency, no
  contract change (contracts are frozen), one table, one route.

## Out of scope
- Binding the debtor to an identity: MerchantPay's invoice `customer` is the zero address (the customer's name stays
  in the merchant's browser), so the ack proves only that the holder of the pay link and a key accepted these terms.
- Revoking an ack, or putting it on chain or on Arkiv.
- Showing the ack on the merchant's "list an invoice" picker (InvoicePanel).
