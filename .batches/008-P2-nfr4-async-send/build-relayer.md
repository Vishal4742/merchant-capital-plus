STATUS: READY

# Build: 008-P2-nfr4-async-send (claude-relayer, phase mode, Money: yes)
- `src/relayer.ts`: `TIMING = { receiptPollMs: 300, receiptTimeoutMs: 8000 }` (exported for tests); `ownReceipt()` polls `getTransactionReceipt(ourHash)` (so never a replacement's); send = `sendRawTransaction`; no receipt in 8 s → 502 `rpc_error` + `txHash`, the cap counted; live transport `batch: true`.
- `test/relayer.test.ts`: fake node mines asynchronously and answers receipts; every send-outcome test on the async path; `sentButNeverMined()` helper for the timeout path.
- Commits: `4d32b3c` test (RED: TIMING missing) → `4c41f5b` perf (GREEN 49/49).
- Live proof of ≤ 5 s needs one real relayed sale (needs the web app to send `x-relay-secret`, or the human's OK for a builder-run sale).
