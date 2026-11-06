# Spec: 032-P5-pay-with-wallet

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-16 (pay with your own wallet, SRS 2.2): the checkout sheet and the invoice page offer "Pay with your wallet"
  next to the default hold: connect an injected EIP-1193 wallet, add or switch to Whitechain Testnet (chain 1874), sign the
  same EIP-3009 ReceiveWithAuthorization the guest signs (eth_signTypedData_v4), POST the same body to the same route.
  No transaction, no gas. Before the hold, the default path asks our server whether the guest has enough USDT and, if
  short, says so and offers the wallet option (with the guest address and Copy) instead of failing after the hold.
- FR-PAY-5 (pay a checkout by signing one message): unchanged server path; any signer's approval is checked by
  verifyTypedData against `from` (lib/pay.ts parseApproval, the sessions and invoices pay routes).
- FR-PAY-7 (plain words): the default path still never says sign, gas, wallet or chain; only the wallet option says "wallet".
- FR-PRIV-1: the pay pages make no browser chain reads: both balance checks go through our server.
- NFR-4 (5 s from signing to confirmed): the balance check runs before the hold, never between signing and the POST
  on the default path; the wallet path adds one server read before its signature prompt, not after it.

## Acceptance criteria (cite AT-… where one exists; each must be checkable)
- [ ] AT-17 (code side): a wallet with test USDT and 0 WBT gets one signature prompt (eth_signTypedData_v4), no
      transaction; the body it produces passes the pay route's verifyTypedData (unit test with an EIP-1193 fake).
- [ ] The wallet's typed data equals saleAuthorization / invoiceAuthorization for the same terms, salt and validBefore,
      exactly as the guest's does (unit test).
- [ ] GET /api/v1/sessions/:id/funds?payer= and /api/v1/invoices/:id/funds?payer= answer only {enough: boolean}
      (never the balance, never an address), 400 on a bad address, 404 on an unknown checkout or invoice, 503 when the
      chain can't be read; the checkout's amount is the amount due now (a held code lowers it); rate limited per IP.
- [ ] AT-17 (empty guest): a browser whose guest has no USDT sees the short notice, the guest address with Copy, and
      "Pay with your wallet" before any hold; "Check again" asks again.
- [ ] Wallet states: no wallet (Install MetaMask link to metamask.io), wrong network (switch/add failed), cancelled
      (4001), a request already open (-32002), not enough USDT in the connected wallet (read via our server), then the
      existing paid / confirming / expired flow.
- [ ] Copy: the default path's text has no sign/gas/wallet/chain; the wallet option is the only place "wallet" appears.
- [ ] CSP unchanged. typecheck, lint, npm test, build pass.

## Files to touch (owner lane: only these)
- apps/web/lib/payer-wallet.ts (new), apps/web/lib/sign-sale.ts (signer parameter, guest address)
- apps/web/app/api/v1/sessions/[id]/funds/route.ts (new), apps/web/app/api/v1/invoices/[id]/funds/route.ts (new)
- apps/web/components/WalletPay.tsx (new), apps/web/components/Checkout.tsx, apps/web/components/InvoicePay.tsx
- apps/web/test/payer-wallet.test.mjs (new), apps/web/test/funds.test.mjs (new), apps/web/test/voucher-pay.test.mjs
  (its source pin of the signSale call gains the `payer` argument)
- .batches/032-P5-pay-with-wallet/round-1/probes/wallet-walk.mjs (the browser walk: FR-PAY-7 scan with the wallet
  option hidden, CSP, states, screenshots)
- Not lib/merchant-wallet.ts (another lane's file): payer code reuses the onboarding chain params instead.

## Ponytail ladder (why this is the smallest change that works)
- The pay routes already accept any signer (verifyTypedData against `from`; checkout-api tests sign with a random
  account): no server change to the pay path. viem's walletClient.signTypedData already sends eth_signTypedData_v4.
- Chain params reuse lib/onboarding.ts WHITECHAIN_TESTNET (batch 029); balance reads reuse lib/onchain.ts
  readUsdtBalance, readInvoice, readRelayFee; rate limits reuse lib/server/http.ts rateLimit. No new dependency.

## Out of scope
- WalletConnect / QR wallets (a third-party relay and a CSP change), smart-contract wallets (EIP-1271), a payer
  that pays its own gas (FR-PAY-16 is gasless), funding the guest from the page.
