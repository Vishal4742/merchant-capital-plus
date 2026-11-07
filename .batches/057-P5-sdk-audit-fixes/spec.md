# Spec: 057-P5-sdk-audit-fixes

## Requirements (cite docs/SRS.md IDs)
- **FR-GW-5** (SDK) and **FR-GW-7** (webhooks): fix what the 7 Nov third-party audit found in `packages/sdk` (research/audit-2026-11-07/D-sdk-and-button.md).
- Keeps **AT-14** working: `apps/shop/lib/sdk.ts` stays an exact copy (its sync test).

## Acceptance criteria (each must be checkable)
- [ ] **H5, install:**
  - the README and the `index.ts` header say how to get the SDK: not on npm; copy `index.ts` into your server code; Node 22.18+ runs it directly, or any TypeScript build;
  - the README imports from the copied file, not from `@merchant-capital/sdk`;
  - the README says why installing it under node_modules fails.
- [ ] **M4, types:**
  - `Priced` is exported, and `Session.priced?` and `CreatedSession.priced?` use it;
  - webhook data has `refund_amount?` and `test?: true`;
  - the comments say `amount` is always USDT, `currency` is the priced currency, and webhook data says USDT.
- [ ] **M4, README webhook handler:** it answers 200 to a test event (`event.data.test`) before looking up an order.
- [ ] **`sameAmount`:** commas count only as thousands separators.
  - `"10,00"` vs `"1000"` → false; `"1,0,0,0"` → false.
  - `"1,000.00"` vs `"1000"` → true.
- [ ] **Idempotency:**
  - `sessions.create` always sends an `idempotency-key` (a random UUID unless given), and retries reuse it;
  - stale comments are fixed: the server dedupes, and it returns 400 for a reference over 40 characters.
- [ ] **Shop copy and checks:**
  - `apps/shop/lib/sdk.ts` is byte-identical, and the shop's tests pass;
  - `packages/sdk` `npm test` and typecheck pass;
  - the shop typecheck passes, if it has one.

## Files to touch (owner lane: claude-sdk)
- `packages/sdk/{index.ts, README.md, test/sdk.test.ts}`
- `apps/shop/lib/sdk.ts`: the copy only, claimed on agentbus 06:12.

## Ponytail ladder (why this is the smallest change that works)
- **Needed:** every item is a finding from an outside developer following our docs.
- **No new code paths:**
  - types and comments;
  - a stricter regex;
  - one `randomUUID()` (the server already dedupes);
  - README text.
- **Not done:**
  - a compiled JS build or an npm publish. Publishing is outward-facing and the human's call; the copy-the-file route is what our own shop does.

## Out of scope
- **`/docs` page text** ("nothing to install from npm"): claude-frontend's `apps/web`. The exact wording goes to them on agentbus.
- **The MCP items:** claude-research's `packages/mcp`.
- **The `currency` meaning in the API:** claude-frontend and claude-contracts. This batch documents current behaviour.
