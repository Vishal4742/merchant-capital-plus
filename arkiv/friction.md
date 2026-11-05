# Arkiv friction log (25% of the Arkiv score)

Logged as it happens, with how to reproduce each problem. Known before we started (research, 2026-11-05):
- SDK 1.0.0 removed payloads and `buildQuery()`; the docs still show older helpers, so AI agents trained on the old API write wrong calls. We read the SDK source instead.
- Public RPC rate limits (429) with reported hangs; batch writes over ~128 KB fail with a misleading error.

| When | What happened | Repro | Workaround |
|---|---|---|---|
| 2026-11-05 20:10 | The keyless Rabdi RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network` didn't answer `eth_chainId` (timeouts at 15 s, 20 s and 25 s; DNS resolves to Cloudflare) | `curl -m 25 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' https://rpc.rabdi.db-chain.testnet.arkiv.network` | SDK 1.0.1 source says the keyless endpoint is "heavily rate limited"; get an access key at hub.arkiv.network/access-keys (it goes in the URL path, `rabdi({ accessKey })`) |
| 2026-11-05 20:20 | 1.0 API is a different shape from every tutorial we found: chain is a function `rabdi({ accessKey })`, no `updateEntity` (use `patchEntity(schema, key, { set, unset })`), typed columns via `defineSchema`, queries `select().from().where(eq()).ownedBy().fetch()`, expiry only via `ExpirationTime` | Read `@arkiv-network/sdk@1.0.1` tarball source (`research_notes/build_prep/frontend_sdk_api.md`) | Wrote an API cheat-sheet from the source before coding |
| 2026-11-05 20:20 | Limits that change our schema: `str` values ≤ 128 bytes, 32 attributes including the schema tag, a bare number is stored as i32 (`u64(x)` / `addr(x)` needed) | SDK source, same notes | Debtor identity stored as a hash; amounts as `u64` in the token's 6-decimal units |
