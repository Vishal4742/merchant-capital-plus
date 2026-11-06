VERDICT: PASS

# Security review: 034-P5-voucher-arkiv-read, round 1

Reviewer: reviewer-security (Opus). Mode: phase, Money: yes. Only HIGH or CRITICAL findings block (PIPELINE.md §3a/§3b).
Scope: `git diff origin/main...HEAD` (628f69b, 8bea066, 3dc6499): apps/web/lib/server/vouchers.ts, test/voucher-arkiv-read.test.mjs (new),
test/gw-vouchers.test.mjs, components/landing/Sections.tsx, plus the batch spec. Requirements: FR-ARK-7, FR-GW-12, AT-12.
Contracts, relayer and signing paths are not in the diff.

No HIGH or CRITICAL findings. The Arkiv read can only narrow what Postgres already allows, every refusal returns before
the hold insert, and every failure path fails closed with a fixed string.

## Checks

| Check | Result | Evidence |
|---|---|---|
| Arkiv can only refuse, never grant | PASS | vouchers.ts:317 `refusal(...) ?? (await arkivRefusal(...))`: Postgres runs first, and the read runs only on a code Postgres accepts (test "a code Postgres already refuses is not read from Arkiv"). arkivRefusal returns null only for a live entity (:278). The discount comes from the Postgres row (:319), never from Arkiv data. |
| Ordering against the hold insert | PASS | Every refusal returns at :318, before the discount and the `transaction` at :326. The tests check `holds(id) === 0` for missing, expired, throw, hang and missing settings. |
| Fails closed | PASS | Missing setting: :267-268 throws, so CANT_CHECK. arkivClients throwing (:269), fetch rejecting, and the 2 s timer all land in the catch, so CANT_CHECK. A missing `expires_at` gives EXPIRED_CODE (:277-278). A malformed value makes BigInt throw, so CANT_CHECK. |
| Entity spoofing by a third-party writer, or an entity transferred to us | PASS | :271 uses `.from(VoucherEntity).where(code_hash).ownedBy(address).createdBy(address)`. The SDK ANDs owner, creator and the schema tag (node_modules/@arkiv-network/sdk/dist/index-CBvzb16i.d.ts:79). An attacker's entity fails createdBy. An entity they hand to our writer also fails createdBy. Our entities can't be moved out: lib/ and app/ have no changeOwnership, updateEntity or deleteEntity (grep). |
| Skipping the read when `arkiv_entity_key IS NULL` | PASS (by design, spec §"Why") | The only write is recordMirror's `SET arkiv_entity_key = $2 … WHERE arkiv_entity_key IS NULL` (:199). No path clears it, and no client input reaches it, so a payer can't switch the read off. |
| Responses leak nothing | PASS | The three reasons are fixed constants (:254-256). The apply route passes them through as 400 (app/api/v1/sessions/[id]/voucher/route.ts:61). No error text reaches the client. |
| Logs leak no code, HMAC secret or access key | PASS (see F4) | :281 logs `v.id` and `redactArkivError(err, ARKIV_ACCESS_KEY)`. Redaction runs before the 200-char slice, so a partial key can't survive. The plain code and VOUCHER_HASH_SECRET never go into the query or the error. |
| Timer cleanup | PASS | `timer` is set synchronously inside the executor and cleared in `finally` on every path (:283-285). If arkivClients throws first, `clearTimeout(undefined)` is a no-op. When the fetch rejects after losing the race, Promise.race has already subscribed to it, so there is no unhandled rejection. The hang test finished in 2010 ms. |
| Rate limit and quota abuse | PASS for blocking, MEDIUM follow-up F3 | A wrong code never reaches Arkiv (the Postgres miss at :314 returns first), so guessing codes costs no Arkiv quota. A valid published code can be amplified across checkouts (F3). |
| Landing copy | PASS | Sections.tsx:260: static text only. |
| Secret scan (required) | PASS, no real secret | `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 6 files found env-var names (vouchers.ts:148, :150, :158, :270) and test placeholders (voucher-arkiv-read.test.mjs:11, :52, :73, :75, :120, :142; gw-vouchers.test.mjs:10, :80, :82, …). `HASH_SECRET = "voucher-hash-secret-for-tests"` and `ARKIV_PRIVATE_KEY = "not-a-key-arkivClients-is-mocked"` are not credentials. There is no 64-hex literal: ENTITY_KEY is built at runtime from `"ab".repeat(32)`. |
| Tests | PASS | `node --experimental-test-module-mocks --test test/voucher-arkiv-read.test.mjs test/gw-vouchers.test.mjs`: tests 56, pass 56, fail 0. |

## FOLLOW-UP (non-blocking)

### F3 (MEDIUM): one public promo code multiplies Arkiv reads across checkouts and drains the shared access-key quota
- Files: apps/web/lib/server/vouchers.ts:269-275 (a read on every apply of a published code, no cache). Rate limits: route.ts:14 and :38 (`voucher:<ip>:<checkout>`, 10/min), lib/server/links.ts:30 and :68 (`checkout:<ip>`, 20/min). All limits are kept in per-instance memory (lib/server/http.ts:126). lib/arkiv.ts:8 (30 s transport timeout).
- Exploit sketch: the attacker takes a code the shop advertises, opens 20 checkouts a minute on the public link and applies the code 10 times on each. That is about 200 Arkiv queries per minute per IP per instance, multiplied by the IPs and instances the attacker can reach. A read that loses the 2 s race is not aborted and stays open for up to 30 s, so a slow Arkiv also piles up open requests. The damage is availability only. The ARKIV_ACCESS_KEY quota is shared with voucher publishing and the Capital offer reads (capital-arkiv.ts:100). Once it is exhausted, every published code is refused with CANT_CHECK. That refusal fails closed: customers still pay full price and no money moves wrongly.
- Fix: cheapest first. (1) Give the read its own transport timeout equal to ARKIV_READ_MS, so a lost race drops the request instead of leaving it open. (2) Keep a short in-memory positive result per voucher id (for example 15-30 s, and never past the entity's `expires_at`). Postgres still checks active, expiry and uses on every apply, so this only skips repeat reads of a state we just saw. Or add a per-voucher read limit that fails closed. The spec lists caching as out of scope, so treat this as a later batch.
- Owner: batch 034 builder (claude-research lane, per batch.md).

### F2 (LOW): the 2 s wait widens the gap between the active/expiry check and the hold insert
- Files: vouchers.ts:317 (`refusal` reads `active` and `expiresAt` from the earlier SELECT at :313) and :329-336 (the INSERT re-checks the usage count under the advisory lock, but not `v.active` or `v.expires_at`).
- Exploit sketch: the merchant deactivates a code, or it expires, while an apply sits in the Arkiv read (up to 2 s, before this batch only milliseconds). That apply still inserts its hold and is paid at the discount. The payer can't control the timing, the usage cap still holds, and the effect is one discount at the edge of a deactivation the merchant just made. The gap existed before this batch. This batch only widens it.
- Fix: add `AND v.active AND v.expires_at > $8` to the INSERT's `WHERE v.id = $2 …` and pass `now` as $8. That is one line and closes it for good.
- Owner: batch 034 builder (claude-research lane).

### F1 (LOW): the read isn't bound to the voucher's recorded entity key
- File: vouchers.ts:271 and :275 (`limit(1)` by code_hash; the returned `$key` is never compared with `v.arkivEntityKey`).
- Exploit sketch: none by a payer. If two entities from our writer share a code_hash, `limit(1)` may return either one. That happens with the duplicate noted at :173, or with another server on the same keys and secret (022 review L1). If the two carry different expiries, the check may read the later one. Postgres's own expiry and active checks still run first and win, so Arkiv can never extend a code past what Postgres allows. The only cost is that the AT-12 claim "the checkout read the code's entity" is looser than it reads.
- Fix: fetch with `limit(10)` and require `entities.find((e) => e.$key === v.arkivEntityKey)`. Or read the recorded key directly and check its owner, creator, code_hash and expires_at.
- Owner: batch 034 builder (claude-research lane).

### F4 (INFO): the log test doesn't prove the code_hash stays out of a real SDK error
- Files: voucher-arkiv-read.test.mjs:110 and :120. viem 2.57.13 node_modules/viem/errors/request.ts:36, :85, :123, :167 put `Request body: …` into the error message, and the body holds the `code_hash` query.
- That is not a secret. code_hash is a public indexed attribute on Arkiv (vouchers.ts:170), keyed with VOUCHER_HASH_SECRET, so the plain code can't be recovered from it. The test's mock error has no body, so its `hashOf("DOWN")` assertion passes vacuously. No action is needed for security. Either drop the hash from the list of things checked as secret, or build the mock error the way viem's HttpRequestError does.
- Owner: batch 034 builder (claude-research lane).
