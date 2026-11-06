# Batch 009 builders (read all, then your section)

Same rules as `/Users/vg890/ethglobal-backend/.batches/007-P4-gateway-api/BUILDERS.md` "Rules" and "Foundation" (read those two sections): worktree `/Users/vg890/ethglobal-backend` (branch backend), only your files, tests first (red → green), Edit/Write only under `apps/`, never read `.env` or any `.env*` file, exclude `.env*` from every recursive search (`grep --exclude='.env*'`), never search another worktree, no git commits, no agentbus. Done = your test files pass, `npx tsc --noEmit` has no errors in your files, `npx eslint <your files>` clean. Report: files, test output tail, anything open. Read `spec.md` in this folder first.

## Builder A: the S1 freeze (vouchers)
Files: `apps/web/db/047_frozen.sql`, `apps/web/lib/server/vouchers.ts`, `apps/web/test/gw-vouchers.test.mjs`.
Read `.batches/008-P4-gateway-followups/round-1/review-security.md` (S1, S2) and the PoC `/private/tmp/claude-501/-Users-vg890-ethglobal-contracts/c6b19a0f-dc4e-4bc4-b19c-2f27badbf70b/scratchpad/poc-reapply.mjs`.
- `047_frozen.sql`: `ALTER TABLE app_gw_redemptions ADD COLUMN IF NOT EXISTS frozen_at BIGINT;` (comment lines start with `--`, no `;` inside comments isn't required any more but keep it clean).
- `claimAmountDue(sessionId, now = Date.now()): Promise<bigint | null>`: null if `checkoutOf(sessionId)` is null; otherwise ONE statement `UPDATE app_gw_redemptions SET frozen_at = COALESCE(frozen_at, $2) WHERE session_id = $1 AND confirmed_at IS NULL AND (frozen_at IS NOT NULL OR created_at > $3) RETURNING usdt_amount::text` → that amount; no row → the checkout's `usdtAmount` (no hold). Idempotent.
- `applyVoucher`: refuse when the session's hold is frozen: add `AND app_gw_redemptions.frozen_at IS NULL` to the ON CONFLICT `DO UPDATE … WHERE`, and also check before (so the reason is "This checkout is being paid."); a frozen hold also counts in the live-holds subquery regardless of age (`AND (r.frozen_at IS NOT NULL OR r.created_at > $6)`).
- `amountDue` stays read-only but should report a frozen hold too (same condition).
- `HOLD_MS = SESSION_TTL_MS + 15 * 60_000` (S2: the relayer accepts signatures up to 900 s); fix tests that assert the old value.
- Tests: the PoC as a test (apply HALF 1-use 50% → claim → apply ONE refused with the new reason → `confirmRedemption(s, claimed)` counts HALF → HALF refuses a second checkout); claim idempotent; claim on a shop session → null; claim with no hold → checkout amount; a frozen hold still counts after HOLD_MS.

## Builder B: priced link/page sessions (AT-13)
Files: `apps/web/lib/server/links.ts`, `apps/web/lib/server/pages.ts`, `apps/web/test/gw-links.test.mjs`, `apps/web/test/gw-pages.test.mjs`.
Read `apps/web/lib/sessions.ts` (createSession v2: `createSession(input, now = Date.now(), ttlMs = SESSION_TTL_MS)`; `input.priced?: Priced`), `apps/web/lib/server/quotes.ts` (`usdRate`, `QUOTE_TTL_MS`, `pricedJson`), and `openCheckout` in `links.ts`.
- In `openCheckout`: for `currency !== "USDT"` pass `priced: {currency, amount: <fiat total as a plain decimal string, formatUnits(fiatTotal, 6)>, rate: rate.rate, rateAt: rate.rateAt, source: rate.source}`; ttl = `QUOTE_TTL_MS` (10 min) for fiat (EUR/GBP/INR/AED/SGD), the default for USD and USDT. Keep the checkout row's `fx` as is. Don't change the 303 / JSON response.
- Tests (links + pages): an EUR checkout's session has `priced` = {currency: "EUR", amount: "20", rate: "0.8", rateAt: today, source} and `expiresAt - createdAt = 600000`; a USD link has `priced.rate === "1"` and the 30-min TTL; a USDT link has no `priced`.
