# Spec: 003-P1-arkiv-probe

## Requirements (cite docs/SRS.md IDs)
- DEP-5: Arkiv SDK 1.0.1 and the Rabdi testnet are available. Prove one write plus one query with our own writer, or drop the Arkiv track (offers stay on-chain).
- NFR-3: the Arkiv writer key lives only in the web app (server-side env, never NEXT_PUBLIC, never in a client bundle).
- SR-ARK-1 (evidence only): the writer address and a runnable query, for the README (claude-research writes the README).
- NFR-8: the probe entity holds no personal data (a fixed note plus a timestamp).

## Acceptance criteria
- [ ] `@arkiv-network/sdk` pinned exactly at 1.0.1 in `apps/web/package.json`. A new dependency, so it needs the human's yes at the gate (PIPELINE §11).
- [ ] `lib/arkiv.ts` `arkivClients(env)` returns Rabdi (7794095) reader + writer + the public writer address. A missing or malformed `ARKIV_PRIVATE_KEY`, or a missing or empty `ARKIV_ACCESS_KEY`, throws an error that names the variable and never echoes its value. An empty access key is refused, because the SDK would otherwise fall back silently to the rate-limited public endpoint.
- [ ] `redactArkivError(err, accessKey)`: the SDK puts the access key in the RPC URL path and viem copies the URL into error messages. Every error the probe prints passes through it, so the key never appears raw or URL-encoded. The test builds a real viem `HttpRequestError` and checks both forms.
- [ ] `scripts/arkiv-probe.ts` (run as `node --env-file=../../.env scripts/arkiv-probe.ts`) creates one `mcplus.probe.v1` entity with a 30-minute expiry, queries it back with `eq("at", …).ownedBy(writer)`, and prints only `{writer, entityKey, txHash, createMs, queryMs, found, expiresInMin}`. It exits 1 if the entity isn't found or on any error.
- [ ] Live evidence in `test.md`: the probe output plus the entity on https://rabdi.explorer.arkiv.network. Read-only pre-check done about 22:53: chainId 7794095, writer 0xF216…8Cbe, balance 0, 0 owned entities, query 936 ms.
- [ ] `npm test` (adds `test/arkiv.test.mjs`, 4 tests), typecheck, lint and build all pass. A grep of `.next/static` for `ARKIV_` and the SDK's RPC host returns nothing (the writer never reaches the browser).
- [ ] Friction (the 2.5 h outage that ended 22:46, the key-in-URL leak, funding) posted to claude-research for `arkiv/friction.md`. The lanes don't edit that file.

## Files (claude-frontend)
`apps/web/{package.json,package-lock.json,tsconfig.json}` (`allowImportingTsExtensions`, so Node can run the probe's `.ts` import), `apps/web/lib/arkiv.ts`, `apps/web/scripts/arkiv-probe.ts`, `apps/web/test/arkiv.test.mjs`, `apps/web/test/arkiv-probe.test.mjs` (added by the tester in round 1: the probe's exit codes and exact output fields, offline)

## Ponytail ladder
- Needed: DEP-5 is a Phase 1 check, and research asked for it next so the Arkiv track survives another outage.
- Reuse: viem's `http` transport and `privateKeyToAccount` (already installed). The SDK's own `rabdi()` chain, typed `defineSchema` and query builder. No wrapper over the SDK beyond env checks and redaction.
- Skipped: the offer schema `mcplus.offer.v1` and the writer route (FR-ARK-1, Phase 4), and browser reads through Nym (FR-PRIV-2, Phase 4).

## Out of scope
Offers, the offer book, the on-chain cross-check (FR-ARK-1–5) and private Arkiv reads (FR-PRIV-2): all Phase 4.

## Needs the human
- tGLM for the writer `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` from hub.arkiv.network. Without it the create fails with insufficient funds.
