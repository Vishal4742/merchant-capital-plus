# Batch 052 round 2: sandbox demo from the installed bundle (2026-11-07)

- **Build:** `npm run pack` at the round-2 head of `wf/merchant-mcpb`: c8fc909, plus the uncommitted demo evidence.
  - Archive sha256: `3ebb5fd5c73e5bb54df8f47ad718d721f87cbf4c3731efc5613061adecdddfef`.
  - Contents sha256: `d9795dd218aa16da37df49310ffc73ca1d1e27cf30ecc246a22cd50f3cf3eb94`.
  - 8 files: LICENSE, README.md, THIRD_PARTY_LICENSES, icon.png, manifest.json, sbom.cdx.json, server/index.mjs, server/sandbox-cli.mjs.
  - Unsigned.
- **Install:** `mcpb unpack` into a temp folder outside the repo.
- **Run:** `node server/index.mjs` over stdio, driven by a throwaway JSON-RPC client. The Owner's approval and the payment come from the bundled `sandbox-cli.mjs`, run as a person would.

```
0. get_business_profile   Demo Business (sandbox) · SANDBOX (simulated) · today is Saturday 2026-11-07 (Asia/Kolkata).
1a. search_customers      No customer matches "Priya".
1b. create_customer       Created customer Priya Sharma (cus_paSKBemugMetR4ES).
2a. create_invoice_draft  Saved a draft invoice for Priya Sharma: 60.00 USDT, due Thursday 2026-11-12 (Asia/Kolkata). Not sent and not payable yet.
2b. finalize_invoice      Publication of 60.00 USDT for Priya Sharma (draft revision 1) is waiting for an Owner's approval. Not published yet; nothing was sent.
2c. Owner: sandbox-cli approve apr_PjYtSZ4n9Um9F9KL → approved: the invoice is published (open) with its number and payment URL.
3.  WF-1001: payment URL https://sandbox.whiteflow.invalid/i/inv_Nx01ndSrnWBZx4Mh
4.  person: sandbox-cli pay WF-1001 → payment.pending applied; payment.succeeded applied, invoice paid in full
5.  get_invoice           WF-1001 for Priya Sharma: paid; 60.00 USDT total, 0.00 USDT due.
6.  get_collection_summary  Monday 2026-11-02 to Saturday 2026-11-07 (Asia/Kolkata): collected 60.00 USDT gross from 1 payment(s), 60.00 USDT net.
extra: create_payment_link ₹15,000 → ₹15,000.00, active, URL on the sandbox origin, conversion note (Whiteflow converts at checkout)
extra: INR invoice → refused, not converted; offers USDT amounts or an INR link
```

Also seen in the first run, before the demo script had the approval step: `finalize_invoice` alone left the invoice without a number or payment URL. Publication can't happen without the Owner (F4).

**Not demonstrated:** the testnet path through the deployed gateway. It needs PR #48 merged and deployed, a merchant sk_test_ key and a funded test wallet, all with the owner.
