VERDICT: PASS

# CI, batch 012-P4-web-developers (phase mode, run by claude-frontend at 07:58)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0 |
| Unit tests | `npm test` | exit 0: tests 372, pass 369, fail 0, skipped 3 (live FX only); re-run 08:08 after the security follow-ups |
| Build | `npm run build` | exit 0; /merchant/developers is ◐ (partial prerender) |
| Live :3100 | curl after the restart (UP posted to claude-relayer at 07:55) | /, /merchant, /merchant/developers, /merchant/links, /docs give 200; GET /api/v1/payments with an unknown sk_ key gives 401 "Missing or wrong API key." |

## New tests
- **Builder (b013):** gateway-dev (11) and shop-keys (5)
  - parsing
  - the key and secret never in a list row, URL or storage
  - the https check
  - plain errors
  - sk ok, pk 403, revoked 401, SHOP_API_KEY still works
  - other merchants invisible
- **Merge additions:**
  - shop-keys: an sk_ key polls its own checkout (200) and gets 404 on another merchant's
  - relay-auth: 403 + x-vercel-mitigated reads as busy (503); a plain 403 reads as 400
  - announce-paid: runs at once outside a request; a failing backend is logged by error name only and nothing throws

## Builder evidence
44 Playwright screenshots in scratchpad/b013-shots, at 375 and 1440, light and dark:
- no overflow, 0 console errors, 0 CSP violations
- the key and secret were never in a URL, storage or any other response, and were gone after a reload

## Not verified live
- Creating keys or webhooks against Neon. The backend's route tests cover those writes.
- A real payment's webhook arriving. That is AT-14, claude-sdk's shop.

## After the security pass (PASS; 1 MEDIUM, 2 LOW, 2 INFO)
- **F1 MEDIUM, fixed: the /docs webhook snippet.**
  - It now ignores test events and repeats (by `event.id`).
  - It finds the order by the checkout id the shop saved (`event.data.id`), never by reference alone.
  - It checks the amount before `markPaid`.
  - The server snippet says to save `session.id` with the order. The live /docs serves the new snippet.
- **F3 LOW, fixed:** POST /api/v1/sessions allows 60 checkouts a minute per merchant, then a plain 429 (new sessions-v2 test).
- **F2 LOW, fixed:** a poll of a paid checkout re-announces it (idempotent), so a payment.succeeded lost to a database blip is sent on the next poll.
- **Told claude-relayer:** add a Vercel firewall bypass for requests that carry x-relay-secret.
