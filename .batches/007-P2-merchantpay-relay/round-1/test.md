VERDICT: PASS

Tester round 1 (fast mode). Commands: `cd apps/relayer && npx tsc --noEmit && npm test`.

## Criteria
- tsc + tests: tsc exit 0; `tests 42, pass 42, fail 0`. PASS
- Unit coverage (paySale/payInvoice 200 with paymentId/gasUsed/gasCostWei, raw tx args decoded, nonce pinned, bad_merchant x4 no RPC, order_paid x2, wrong_amount, fee-missing invoice -> bad_signature, <1 USDT invoice accepted, pull -> 400): present in the 42; read against src/relayer.ts. PASS
- Nonce formula: relayer.ts `merchantPayNonce` = keccak(abi.encode(1874, MerchantPay, kind, ref, orderRef, amount, salt)); matches MerchantPay.sol:241-249 (sale ref = uint256(uint160(merchant)), invoice orderRef = 0). PASS
- Invoice signs amount + relayFee (relayFee read single-flight, 60 s cache, failed read not cached); balance check uses same value. PASS
- Arg order paySale/payInvoice matches MerchantPay.sol:135/163. Error mapping: OrderPaid/InvoiceNotOpen -> order_paid, WrongAmount -> wrong_amount, InvalidOrder -> bad_merchant. paymentId from Paid log filtered to MerchantPay address. PASS
- Allowlist: parser accepts only two actions; every send builds calldata via `calldata()` to MERCHANT_PAY only. PASS
- Live no-tx (dev server, fresh random 0-USDT payers): paySale -> `422 insufficient_funds`; USDT as merchant -> `422 bad_merchant`. PASS
- Relayer nonce after run: `cast nonce` = 3 (unchanged). PASS
- Live nonce equality vs chain / relayFee: builder's evidence accepted (not re-run; unit test pins the formula against independent encodeAbiParameters). PASS
- Live relayed sale: G2 joint run, not here.

## Timing (20 warm requests, ~4/s)
- GET /health: p50 2 ms, p95 3 ms
- local reject (bad_merchant): p50 2 ms, p95 5 ms
- RPC-round reject (insufficient_funds): p50 148 ms, p95 269 ms (NFR-14 <= 500 ms met)

## FOLLOW-UP (MEDIUM/LOW, not blocking)
- LOW relayer.ts (simulationReject): orderRef = 0x00..00 on a sale is only caught by the contract (InvalidOrder), after the RPC round, reported as `bad_merchant` (misleading text). Could be a free local check `bad_order`. Owner: relayer.
- LOW: contract paused -> `would_revert` (generic); fine for now.
- LOW: payInvoice with `from` outside local checks has no cap on invoiceId beyond uint256; harmless (simulation reverts InvoiceNotOpen).
