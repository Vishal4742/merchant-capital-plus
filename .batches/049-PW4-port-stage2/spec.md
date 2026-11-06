# Spec: 049-PW4-port-stage2 — bring WhiteFlow Stage 1–2 from the snapshot into git

No new behaviour. This batch moves already-gated work (batch 031-PW4, closed at the owner's human gate 2026-11-06) from the non-git snapshot onto a branch off main, merges it with everything main gained since the snapshot was taken (Privy payer, MCP connector, Capital UI, settlement withdraw, admin Safe, debtor ack docs), and proves the merged tree still passes every check.

## Requirements (cite docs/SRS.md IDs)
- Stage 2 (batch 031, unchanged): **FR-GW-7**, **FR-PAY-10** (webhook outbox: atomic event marker + deliveries, leases, isolation, pinned HTTPS), **FR-REL-5**, **FR-REL-6**, **FR-REL-10** (relayer lease + fence, write-ahead `rel_sent`, durable budget/limits/cooldown, fail-closed DB).
- WhiteFlow requirements baseline: SRS v3.0 §8 adopted by the owner 2026-11-06 (FR-BIZ-*, FR-AUTH-*, FR-BILL-*, FR-CHK-*, FR-RFD-*, FR-OPS-*, FR-RTE-*, FR-MCP-6..11, FR-UX-*, NFR-15..19, CON-10..14, AT-19..56) merged with main's v2.3 changes (FR-PAY-16 Privy payer, FR-GW-15, FR-MCP-1..5).
- **FR-UX-1** WhiteFlow brand, **FR-UX-2** dashboard navigation (rebrand already built in the snapshot).
- **FR-OPS-9** durable web rate limits (052), **FR-OPS-6** (partial: outbox pieces from 031).

## Acceptance criteria
- [ ] P1 The snapshot is committed onto 3cd0dc9 in small commits by area (docs, relayer, web server, web UI, tests, tools) with no node_modules, build output, `.env*`, screenshots of secrets or Stage 3 drafts.
- [ ] P2 `git merge origin/main` resolves every conflict keeping BOTH sides' behaviour: main's relayer `store.ts`/FR-REL-10 design is reconciled with the snapshot's lease/fence/write-ahead state by a **forward** migration (never edit an applied migration); main's Privy payer, withdraw, Capital and MCP code keep working.
- [ ] P3 Web: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass. Relayer: typecheck + tests pass. SDK, MCP, `forge build` + `forge test` pass. Secret scan clean. (= the pre-push hook + CI required checks: changes, secrets, web, contracts, relayer, sdk, mcp.)
- [ ] P4 Stage 2 real-Postgres harnesses (`apps/web/test-pg`, `apps/relayer/test-pg`) still pass against the isolated `wf_s2_*` databases only (never the live app DB).
- [ ] P5 Migrations: web `051`, `052` and relayer migrations apply clean twice and on top of main's schema (previous-schema check), additive only.
- [ ] P6 PR to main opened from the branch; nothing pushed to main.

## Files to touch
Everything batch 031 touched (listed in `.batches/031-PW4-stabilize-webhooks-relayer/`), the rebrand files, docs/SRS.md, PHASES.md, notes/whiteflow-*.md, tools/stage2/*, plus merge-conflict resolutions in files main changed.

## Ponytail ladder
Needed: yes — every later stage builds on Stage 2 and the PR-only rule means the work must be in git. Already in repo: yes, as a snapshot; git's own 3-way merge does the porting (no hand copying of main's changes). No new dependency beyond what 031 already approved (`@neondatabase/serverless` + `@electric-sql/pglite` in the relayer).

## Out of scope
Stage 3 identity (next batch), any deployment, any migration run against the live app DB, live chain transactions.
