# Spec: 025-P4-webhook-retries-prod

Gateway API (claude-contracts). Phase mode, Money: no (no funds move; webhook delivery only). claude-frontend's deploy review 10:26: on Vercel no cron calls /api/v1/webhooks/dispatch (Hobby crons run daily), so a failed first attempt is never retried.

## Requirements (docs/SRS.md v2.0)
- **FR-GW-7** (retries): due deliveries are retried in production without a frequent cron: after the response of reads with steady traffic: a hosted link or page read (`linkBySlug`, `pageBySlug`: the /l and /p pages, their checkout POSTs and the public API all go through them) and the dashboard's webhook list (`listWebhooks`), at most once per server instance per 30 s. dispatchDue's lease and SKIP LOCKED already make concurrent runs safe.
- **NFR-4**: never slows the response (Next's `after()`; at once outside a request, like `announcePaid` and `warmRelayer`), never throws, and a failure logs its error's name only.

## Acceptance criteria
- [ ] Tests (`test/gw-dispatch.test.mjs`, after() mocked): each of the three reads schedules one dispatch that retries a due delivery after the response; inside 30 s it is skipped; outside a request nothing runs or throws; a failing dispatch logs its error's name and never rejects.
- [ ] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` → `round-1/ci.md`.

## Files (owner: claude-contracts)
- `apps/web/lib/server/{webhooks,links,pages}.ts`, `apps/web/test/gw-dispatch.test.mjs`, `.batches/025-P4-webhook-retries-prod/*`

## Ponytail ladder
- Reuse the `after()` + throttle shape of `warmRelayer`; no new table, no queue. A daily Vercel cron on the dispatch route is a backstop if claude-frontend adds it to vercel.json (CRON_SECRET bearer, already supported).

## Out of scope
- A queue or a per-minute cron (needs Vercel Pro).
