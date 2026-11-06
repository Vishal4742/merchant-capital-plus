# Spec: holder caps per claim kind (phase mode, Money: yes)

## Requirements
- **FR-ADV-3 / FR-INV-2 / FR-TOK-8:** funding and transfers keep every claim repayable under the relayer's 400k gas (claude-contracts Q19 + 11:26 table). Each sale or repayment pays every holder in one tx:
  - an **advance** takes at most **1** holder (2 holders at 0 USDT clearing the cap need 420,381 gas);
  - an **invoice** takes at most **2** (unchanged).
- `POST /api/v1/capital/fund` refuses a new distinct investor once the claim is at its cap; an existing holder can still add units.
- `GET /api/v1/capital/transfer-check` refuses a transfer that would add a holder past the cap. Moving everything, or sending to an existing holder, keeps the count.

## Acceptance criteria
- [ ] Tests first in test/capital-fund.test.mjs and test/capital-core.test.mjs, covering both kinds.
- [ ] apps/web: capital tests, typecheck and eslint pass.

## Files
apps/web/lib/server/capital.ts, apps/web/lib/server/capital-fund.ts, apps/web/test/capital-fund.test.mjs, apps/web/test/capital-core.test.mjs.
