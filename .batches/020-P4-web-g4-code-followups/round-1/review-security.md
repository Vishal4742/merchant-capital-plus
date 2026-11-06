VERDICT: PASS

# Security review: 020-P4-web-g4-code-followups, round 1 (phase mode, Money: yes), re-checked after the F1/F3 fix

Scope: `git diff -- apps/web` (11 files) plus context in `lib/server/events.ts`, `lib/server/checkouts.ts`, `lib/server/vouchers.ts`, `lib/server/webhooks.ts`, `apps/relayer/src/relayer.ts`, `apps/relayer/api/health.ts`. Code was not edited. The first pass said CHANGES (F1 HIGH). The coordinator fixed F1 and F3 in the working tree; I re-checked only those changes, and nothing HIGH or CRITICAL is left. F2 and F4 go to claude-contracts and don't block. Note: `.batches/G4-phase-review/round-2/review-code.md` doesn't exist (round-2 has only `review-ux-ui.md`), so M2 was taken from the spec's description.

## 1. HIGH, now FIXED: warmRelayer let any anonymous visitor send our server's traffic to the relayer, one ping per page load
- Original issue: every render scheduled its own `GET <RELAYER_URL>/health`, with nothing deduping them in the process (probe: 100 calls gave 100 fetches). On `/l` and `/p` it fired before the slug check, so `/l/x` pinged too. The relayer's 5 s cache is its in-process WBT balance only. `/health` sends no Cache-Control header, so Vercel's edge counts every request. HANDOFF_LOG 06:48 records Vercel's IP-scoped burst mitigation firing on this relayer at our own probe volume. So a curl loop on `/l/x` could get our server's IP challenged. Every `/relay` would then get `403 x-vercel-mitigated`, which reads as BUSY, and every merchant's checkout would fail.
- Fix verified (`apps/web/lib/relay.ts:116-147`):
  - `WARM_EVERY_MS = 30_000` and a module-level `lastWarmAt`, checked at `:134` after URL validation. Bad URLs never use up the slot.
  - Fresh scratch probe in real time: 100 calls gave 1 fetch.
  - Test `test/relay-auth.test.mjs`: 100 calls over 10 s schedule 1 ping. At +30 s, 1 more. Bad URLs (http to another host, unset, junk, `mailto:x`), checked at a time the throttle would allow, schedule none, so the URL guard really is what refuses them.
  - Callers now:
    - `/l` (`app/l/[slug]/page.tsx:54`): only an active link, after `SLUG.test`, the read, `notFound` and the closed-link branch.
    - `/p` (`app/p/[slug]/page.tsx:43`): only after the page is found.
    - `/checkout` (`:64`): only an existing session with no payment.
    - `/pay` (`:44`): after the invoice-id regex and pay config.
  - Remaining ceiling (INFO, fine): the limit is per server instance (and per module copy, if Next bundles one per route). Under scale-out that's at most one ping per instance per 30 s. It no longer grows with visitor traffic.

## 2. MEDIUM (non-blocking, pre-existing, more likely after this batch), OPEN with claude-contracts: a retry can send a second payment.succeeded with a new event.id
- Files: `apps/web/lib/server/events.ts:32-41` (sendOnce releases its key on any throw), `apps/web/lib/server/webhooks.ts:145-159` (deliver), `:137-140` (attemptDelivery's UPDATE after the POST).
- Checked per step of `onSessionPaid` (events.ts:45-48):
  - `markCheckoutPaid`: `UPDATE ... WHERE paid_at IS NULL` (checkouts.ts:89). Idempotent, including two concurrent runs. A link is never marked paid twice.
  - `confirmRedemption`: the CTE `WHERE confirmed_at IS NULL AND usdt_amount = $3` gates the `times_redeemed + 1` (vouchers.ts:354-361). Idempotent and race-safe, so a code is never counted twice.
  - `sendOnce`: `INSERT ... ON CONFLICT DO NOTHING` dedupes a clean second call. The gap is a partial enqueue. A delivery row is inserted (or the merchant POST is even made), and then something throws: the next endpoint's INSERT, or the status UPDATE during a DB blip. The key is deleted, and the retry (or a visit to the page or receipt) runs `deliver()` again with a fresh `newId("evt")`.
- Impact: `packages/sdk/README.md:63` tells merchants to dedupe on `event.id`, so a merchant who follows it could ship twice. It needs a DB error at that exact point, so an attacker can't trigger it.
- Fix (claude-contracts): make the enqueue all-or-nothing. Use one multi-row INSERT and `attemptDelivery(id, now).catch(() => null)`: the row is pending with a lease, and dispatchDue retries it. Alternatively, derive the event id from the sendOnce key.

## 3. LOW, now FIXED: warmRelayer's "never throws" and the open response body
- Was: `URL.canParse("mailto:x")` is true, but `new URL("/health", "mailto:x")` throws. The success handler also never cancelled the response body.
- Verified: `new URL` sits in try/catch at `lib/relay.ts:126-130`. Probe: `mailto:x` and `data:,x` neither throw nor schedule. `:138` calls `res.body?.cancel().catch(...)` (optional chaining short-circuits on a null body). Probe: 1 ping, 1 body cancelled.

## 4. LOW, OPEN with claude-contracts: each visit to a paid checkout or receipt costs about 4 cheap DB statements, with no webhook storm
- `checkout/[sessionId]/page.tsx:63` and `r/[id]/page.tsx:54` run `onSessionPaid` on every visit: two no-op UPDATEs, `checkoutOf` (built before sendOnce checks its key, events.ts:48) and one `INSERT ... ON CONFLICT DO NOTHING`. If the DB is failing, the retries raise that to at most 12, after the response. It's bounded, and sendOnce stops any second webhook. Optional: check the key before building `eventData`.

## Checked and passing
- **Retries** (`lib/announce-paid.ts:23-33`): exactly 3 tries with waits of 500 ms and 1,500 ms, inside `after()`, no throw. The log line (`:29`) has the session id, the try number and `error.name` only.
- **Re-announce amount**: `Payment.amount` is a required bigint (sessions.ts:44). Both `recordPayment` callers set it to the relayed price, so `?? session.amount` never runs. Sessions are in memory only, and `confirmRedemption` fails closed on a mismatch.
- **Who can trigger it**: only a session already paid server-side. No visitor input reaches the session or the amount.
- **Numeric /r/[id]**: `r/[id]/page.tsx:50` returns `<PaymentReceipt>` before the announce at `:54`, so it never announces.
- **warmRelayer target**: `RELAYER_URL` comes from `process.env` only (config.ts:20). The https/loopback check holds (`[::1]` matches, `127.0.0.1@evil.com` resolves to evil.com and is refused). No headers are sent. It has a 3 s timeout, and errors are swallowed. In the request path it is scheduled only.
- **paid_at on /l** (`components/gateway/Hosted.tsx:53-54`): escaped React text, guarded by `Number.isFinite(Date.parse(...))`, fixed locale and time zone. The server sends it only when the link is paid (links.ts:194).
- **Secrets grep** (`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` on every diff file and the spec, re-run after the fix): hits only in pre-existing lines. These are the env var name `RELAY_API_SECRET` in `lib/relay.ts:50,53` and the fake test fixture plus env-var names in `test/relay-auth.test.mjs`. The same grep over the diff's added lines finds nothing.
- **Tests**: a fresh scratch copy after the fix (rsync with `--exclude='.env*'`, 0 `.env*` files in the copy), `npm test`: 454 tests, 452 pass, 0 fail, 2 skipped.

## Lanes
- claude-frontend: F1 and F3, fixed.
- claude-contracts: F2 (MEDIUM) and F4 (LOW), open and non-blocking, forwarded by the coordinator.
