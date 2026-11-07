STATUS: READY

# Build: 052-PW5-merchant-mcpb (lane claude, worktree P:/wf-mcpb, branch wf/merchant-mcpb)

## DONE
- **apps/web: secret keys for the connector (FR-GW-16 proposed).**
  - `lib/server/idempotency.ts`: the sessions slots, moved verbatim, plus `replayed` and `requestHash`.
  - `lib/server/keys.ts` `callerMerchant` (pk → 403).
  - `app/api/v1/links/route.ts`: sk key, durable Idempotency-Key, 30 creates a minute.
  - `app/api/v1/links/[id]/route.ts` (new).
  - `app/api/v1/account/route.ts` (new).
  - `app/api/v1/reports/route.ts`: sk key.
  - Verified by `test/gw-mcp-api.test.mjs` 9/9 and the full web suite in the pre-push hook.
- **packages/mcp: the Whiteflow merchant MCP.**
  - 12 tools and 4 prompts: `src/tools/*`, `src/prompts.ts`.
  - The client: `src/client.ts`, `src/contract.ts`.
  - Integer money: `src/money.ts`. Zone dates: `src/dates.ts`.
  - Redaction and untrusted text: `src/safety.ts`. The key journal: `src/journal.ts`. The locked state file: `src/state.ts`.
  - The sandbox: `src/sandbox/{store,records,backend,provider,cli}.ts`.
  - Verified by `npm test`, 31/31.
- **Packaging.**
  - `scripts/manifest.mjs`: the manifest comes from runtime discovery.
  - `scripts/build.mjs`: the esbuild one-file bundle, its licences, and a refusal of machine-specific paths.
  - `scripts/pack.mjs`: mcpb validate, pack and info, and the checksums.
  - `scripts/icon.mjs` and `icon.png`.
  - Verified by `test/package.test.ts`: it unpacks the archive and launches it with node, checks that stdout is JSON-RPC only and that discovery equals the manifest, and runs the demo through the bundled CLI.
- **Docs:** `packages/mcp/README.md` (install, auth, demo, prompts, tools, security, limits, phase two) and `API-CONTRACT.md`.
- **Removed:** pay_checkout, spending_report and MCP_PAYER_KEY (SRS v3.0 R1).
- **Review round 1:** both verdicts are PASS. Fixed in this round: M1/M2 (security), the code review's blocking finding (the same M2), L1–L6, F2, F5, F6, F8, F11 and F12. Still open: F3, F4, F7, F9, F10 and F13 (see OPEN).

## OPEN
- **F3:** `apps/web/lib/docs-reference.ts` should document `/api/v1/account`, `/api/v1/links/{id}`, the Idempotency-Key on links and their 30/min limit (claude-frontend's file).
- **F4:** root README §AI assistant and ARCHITECTURE.md:122 still describe the old connector (claude-research).
- **F7:** callerMerchant and merchantByCookieOrSecretKey overlap. Merge them when 051 replaces both with `legacyAccess`.
- **F9:** reusing a caller key for a different payload replaces its journal entry (the backend still answers 422).
- **F10:** after an uncertain first attempt, a duplicate-customer 409 shows "outcome unknown"; retrying is safe.
- **F13:** the 30/min link limit also applies to the dashboard.

## NEEDS THE USER
- Approve the SRS-CHANGE (FR-MCP-12..17, FR-GW-16), including R2-1 for batch 051: secret keys may create and read links and read the account and report.
- These routes are claude-contracts' lane after the freeze (PIPELINE §5). Approve this lane editing them, or hand the diff to claude-contracts.
- The new dev-only dependencies: esbuild 0.28.2 and @anthropic-ai/mcpb 2.1.2.
- Rotate the Privy app secret (see batch.md).
