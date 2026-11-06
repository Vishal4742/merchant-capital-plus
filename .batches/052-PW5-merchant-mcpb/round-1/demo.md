# Batch 052 sandbox demo (2026-11-07, from the installed bundle)

How it was run:
- `npm run pack` built `dist/whiteflow.mcpb`, sha256 `8fcb743d7c0ab4a1c8bb9f1cc5709d27d6d068807894bfdfe7736d7eec146c5c`. Its contents-sha256 is `ea16076a202ed5627f5070e7033f82356fd79e1674a6a68f8d5b5f976f391a76`; the files are LICENSE, README.md, THIRD_PARTY_LICENSES, icon.png, manifest.json, server/index.mjs and server/sandbox-cli.mjs.
- The archive was unpacked with `mcpb unpack` into a temp folder outside the repo, and `server/index.mjs` was started with plain `node` over stdio. A throwaway JSON-RPC client sent initialize, then tools/call.
- Settings: WHITEFLOW_TIMEZONE=Asia/Kolkata; the sandbox mode is the default.

```
environment: sandbox — SANDBOX: simulated on this computer. No real money moved, nothing was sent, and sandbox.whiteflow.invalid URLs don't open.

0. get_business_profile
  Demo Business (sandbox) · SANDBOX (simulated) · today is Saturday 2026-11-07 (Asia/Kolkata).
1a. search_customers Priya
  No customer matches "Priya".
1b. create_customer
  Created customer Priya Sharma (cus_rAvbbeQE808JRlyd).
2a. create_invoice_draft (3 × 20.00 USDT)
  Saved a draft invoice for Priya Sharma: 60.00 USDT, due Thursday 2026-11-12 (Asia/Kolkata). Not sent and not payable yet.
2b. finalize_invoice
  Invoice WF-1001 for Priya Sharma is open: 60.00 USDT, due Thursday 2026-11-12 (Asia/Kolkata).
3. payment URL: https://sandbox.whiteflow.invalid/i/inv_rdR1EdSnDWG3bKs8  (delivered: false)
4. person runs: sandbox-cli pay WF-1001
  SANDBOX: simulated payment pay_Tj9AshX5L4CSmvKM of 60.00 USDT for WF-1001 (normal). Signed provider events:
    payment.pending    applied   payment pending
    payment.succeeded  applied   invoice paid in full
5. get_invoice
  WF-1001 for Priya Sharma: paid; 60.00 USDT total, 0.00 USDT due, due Thursday 2026-11-12 (Asia/Kolkata).
6. get_collection_summary this_week
  Monday 2026-11-02 (Asia/Kolkata) to Saturday 2026-11-07 (Asia/Kolkata): collected 60.00 USDT gross from 1 payment(s), 60.00 USDT net.
extra. create_payment_link ₹15,000
  Created a payment link for ₹15,000.00 — Acme website redesign. Status: active.
  Priced in INR. When the customer opens the link, WhiteFlow converts it to USDT at a rate locked for that checkout (shown to the customer); they pay USDT and you receive USDT. The connector did not convert anything.
extra. INR invoice is refused, not converted
  Invoices are issued in USDT, the settlement asset, and the connector never converts currencies. INR amounts can't be used as they are.
```

Not demonstrated: a real testnet payment through the deployed gateway. It needs this PR merged and deployed (GET /api/v1/account and sk-key links), plus a merchant sk_test_ key and a funded test wallet. Those belong to the human, not this session.
