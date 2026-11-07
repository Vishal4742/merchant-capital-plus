VERDICT: PASS

# CI: 008-P2-nfr4-async-send (phase mode, PIPELINE.md §3b)
- Own checks (`apps/relayer`): `npx tsc --noEmit` → exit 0; `npm test` → tests 49, pass 49, fail 0 (1.8 s). No `eth_sendRawTransactionSync` left in `src/` (grep: comments only).
- GitHub Actions on `4c41f5b`: https://github.com/Vishal4742/whiteflow/actions/runs/42140223700 — **success** (changes, secrets, relayer; sdk/web/contracts skipped: untouched).
- Profiling that motivated it (venue → Ankr, read-only): 5-call round cold 916 ms → 345 ms batched; warm ~350 ms; AT-1 (`0x7e03b5d0…7a11`, block 12,329,601) took 10.08 s sign-to-receipt with ~7 s inside the sync send.
- Probe: Whitechain's RPC accepts plain `eth_sendRawTransaction` (decode error on junk, not -32601), so its faster reads are an option again; default stays Ankr (proven by AT-1's real send).
