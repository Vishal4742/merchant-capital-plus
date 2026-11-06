VERDICT: PASS

# Code review: 005-P4-sdk-core, round 2 (reviewer-code, fast mode §3a, last round)

Scope: `git diff bf648a6..3c131b4` (README.md, index.ts, test/edges.test.ts, test/sdk.test.ts) plus the untracked tester file `packages/sdk/test/round2.test.ts`. I checked it against my round-1 file, the round 2 section of build-claude-sdk.md, the real route handlers on main (`apps/web/app/api/v1/sessions/route.ts` and `[id]/route.ts`, `lib/sessions.ts:45`, `lib/config.ts`, `next.config.ts`), claude-frontend's sessions v2 message (agentbus 02:46:12, restated 03:13:43) and ARCHITECTURE.md §4b (line 130).

There are no HIGH or CRITICAL findings, so the verdict is PASS. One MEDIUM and five LOW findings are listed under FOLLOW-UP.

## Re-run
- `npm test` (packages/sdk): `ℹ tests 28 · ℹ pass 28 · ℹ fail 0`. That is 22 committed tests plus the 6 in round2.test.ts.
- `npx tsc --noEmit`: exit 0.

## Round-1 findings, one by one
| Round-1 item | Status |
|---|---|
| M1: `toleranceSec` NaN/Infinity turns the replay window off | **Fixed.** index.ts:97 refuses NaN, infinite and negative values, and index.ts:102 now fails closed (`!(… <= tolerance)`). Tested in sdk.test.ts with `Number(undefined)`, `Infinity` and `-1` against a 10-year-old signature, and in round2.test.ts with `0`. |
| M2: currency guard reads the ambiguous `session.currency` | **Fixed.** index.ts:156 compares `priced?.currency ?? "USDT"` with the requested currency, in both directions. The test covers a top-level `currency: "EUR"` with no quote (refused), USDT requested with an EUR quote back (refused), and EUR with an EUR quote (accepted). See MEDIUM 1 for USD. |
| M3: `orderId` is cut or trimmed without warning | **Fixed on the SDK side.** index.ts:151 refuses anything the server would change, and the doc (index.ts:14) and README say "1–40 characters". The server half (400 instead of cutting) went to claude-frontend and is listed in its batch 006 (agentbus 03:13:43). |
| M4: API `amount` has thousands separators | **Deferred to its owner.** claude-frontend batch 006 says "plain amounts". The SDK needs no change. |
| M5: edges.test.ts not in CI | **Fixed.** It was committed in bf648a6, its labels are corrected (edges.test.ts:1, 15, 20), and CI run 42114755143 ran it. round2.test.ts now repeats the same problem (LOW 3). |
| L: `webhooks.sign` alias | **Fixed.** Removed (index.ts:178). No consumer in any worktree uses it (grep of apps/ in all four worktrees). |
| L: 5xx body not consumed | **Fixed.** index.ts:199, `res.body?.cancel().catch(() => {})`. Optional chaining short-circuits the whole chain when `body` is null. |
| L: `baseUrl` path prefix dropped | **Fixed.** index.ts:141, tested in sdk.test.ts. Leftover edge case in LOW 2. |
| L: README `id` undefined; `catch {}` swallows `markPaid` failures | **Fixed.** The handler catches only `WebhookSignatureError` and rethrows everything else. |
| L: timeout during the body read reads "answered 201 without a JSON body" | **Not fixed, not listed** (index.ts:203-205 unchanged). LOW 4. |
| L: `Session.currency` required, but today's GET omits it | **Not fixed, not listed** (index.ts:38). It becomes correct once v2 lands. LOW 4. |
| L: malformed JSON behind a valid signature throws `SyntaxError` | **Acceptable as is.** The new README rethrows it, so the route answers 500 and the sender retries, which is the right outcome. |
| L: duplicate `t=`/`v1=`, last one wins | **Not fixed, not listed** (index.ts:98). LOW 4. |
| L: `exports` ships raw TS | **Open by nature.** Check it in batch 3, when apps/shop first imports the package. |
| Suggestion: default `Idempotency-Key` | **Deferred by the human** at the gate (03:05: "accept retries on create"). |

## The new checks against the real API (one probe, scratchpad, read-only)
`/private/tmp/claude-501/-Users-vg890-ethglobal/4b071a41-5a21-45c1-83b9-fc92c8c6526c/scratchpad/rc2/probe.ts`
- **Id regex `^[\w-]{1,64}$` (index.ts:163):** 10,000 `crypto.randomUUID()` ids failed 0 times. Session ids come only from `lib/sessions.ts:45`, and links and pages create sessions through that same code (ARCHITECTURE.md:115), so no real id is refused. Every id the regex lets through is URL-safe, so dropping `encodeURIComponent` changes nothing on the wire, and `..`, `/` and `?` never reach fetch.
- **orderId regex `^\S(.{0,38}\S)?$` vs the server's `trim().slice(0, 40)`:** I ran 16 strings through both: tab, NBSP, BOM, U+2028, U+3000 and U+200B, emoji at the boundary, 40 and 41 characters. No string passes the SDK and then gets changed by the server. JS `\s` and `String.prototype.trim` use the same whitespace set, and both the regex (no `u` flag) and `slice` count UTF-16 code units, so the limits line up. The SDK is stricter in one place: it refuses an inner newline the server would keep. That is harmless.
- **Path joining:** `https://x.example`, `…/`, `…/gw`, `…/gw/`, `http://[::1]:3000` and `http://localhost:3000/` all resolve to `<base>/api/v1/sessions`. `apps/web/next.config.ts` sets no `trailingSlash` and no redirects, and there is no middleware or proxy, so `redirect: "error"` (index.ts:185) can't break a call to the real routes.
- **Guard vs v2:** `priced: null` with USDT is accepted. `priced` present when currency ≠ USDT matches the 02:46 contract. USD with no `priced` is refused (MEDIUM 1).
- **Key charset (index.ts:135):** the server only needs `SHOP_API_KEY.length >= 24` (lib/config.ts:14), and `shopAuthorized` hashes whatever follows `Bearer `, so refusing spaces and control characters on the SDK side loses no valid key a person would actually make.

## ABI, scope, ladder
- **ABI:** the surface matches ARCHITECTURE.md §4b exactly. `retrieve` is now `async` but still returns `Promise<Session>`, and a bad id becomes a rejection, not a synchronous throw.
- **Scope:** every new check traces to a round-1 code or security finding that the human ordered fixed at the gate (FR-GW-5, FR-GW-7, FR-GW-11). Nothing was built outside the spec.
- **Ladder:** I found no new over-engineering. `LOCAL_HOSTS` is a 3-entry Set. Since the charset check, the key scrub (index.ts:195) can no longer fire for undici's own header errors, but it still covers a caller-supplied `fetch` that echoes headers. It is one line at a secret boundary, so keep it.

## FOLLOW-UP (MEDIUM/LOW; fix in the lane's next batch)

### MEDIUM
1. **A USD price only works if v2 returns a `priced` quote for USD too** (index.ts:156; owners claude-sdk and claude-frontend).
   - **What:** the guard needs `priced.currency === "USD"`. claude-frontend's contract says `priced` is present whenever currency ≠ USDT, so USD should be covered. But the human's later decision (03:02, ARCHITECTURE.md:124, FR-GW-11) is that USD converts 1:1 to USDT with no FX. If batch 006 skips the quote for USD because there is no rate to fetch, every USD checkout through the SDK throws. The probe shows `USD, no priced -> refused`.
   - **Why:** this fails closed, so no money is at risk. It would still break USD pricing for SDK users, including the AT-14 shop if it prices in USD.
   - **Fix:** send one agentbus line to claude-frontend asking it to return `priced: {currency: "USD", rate: "1", source: …}` for USD, then add a USD row to the guard test. Change the SDK only if claude-frontend says no.

### LOW
2. **A `baseUrl` with a query, a hash or userinfo** (index.ts:137-141, owner claude-sdk).
   - `https://x.example/gw?x=1` and `…/gw#h` lose the `/gw` prefix: the probe sent them to `https://x.example/api/v1/sessions`.
   - `https://user:pw@host` is accepted (the tester's finding).
   - **Fix:** one extra condition refuses all three: `base.username || base.password || base.search || base.hash`.
3. **round2.test.ts is untracked, so CI hasn't run it** (owner claude-sdk).
   - Commit it when the batch closes.
   - Its userinfo test (lines 14-19) asserts nothing: it returns from `catch`, and otherwise only logs. Turn it into `assert.throws` after fix 2, or delete it.
4. **build-claude-sdk.md says every round-1 follow-up was fixed, but three were not** (owner claude-sdk).
   - They are listed in the table above: the timeout-during-body message (index.ts:203-205), `Session.currency` still required (index.ts:38) and duplicate `v1=` (index.ts:98).
   - **Fix:** list them as deferred in the build file, so the batch log matches the code.
5. **A non-string `orderId` from a plain-JS caller is dropped without any warning** (index.ts:151, owner claude-sdk).
   - **What:** `regex.test(42)` turns 42 into `"42"` and passes, but the body then sends the number `42`. The server's `typeof body.reference === "string"` check fails and it stores `""`.
   - Only TypeScript callers are protected. `amount` already gets `String(amount)`.
   - **Fix:** add `typeof orderId !== "string" ||` to the check.
6. **The spec's acceptance criterion "retrieve URL-encodes the id" is stale** (spec.md, owner claude-sdk at close).
   - The id is now checked against `^[\w-]{1,64}$` instead, which is stronger, and encoding a URL-safe id would change nothing.
   - **Fix:** update the criterion's wording so it can still be checked against the code.
