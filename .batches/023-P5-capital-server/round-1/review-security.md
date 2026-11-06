VERDICT: FAIL

# Security review: 023-P5-capital-server, round 1 (phase mode, Money: yes)

Scope: `git diff origin/main...HEAD` for `apps/web/lib/server/capital.ts`, `capital-arkiv.ts`, `capital-fund.ts`, `apps/web/app/api/v1/capital/**` (six routes) and `apps/web/test/capital-*.test.mjs`. For context I read `contracts/src/CapitalMarket.sol`, `contracts/src/ClaimToken.sol`, `apps/relayer/src/relayer.ts` (`parseFunding`, `prepareFunding`, `localChecks`, `ledgerChecks`, `send`), `apps/web/lib/relay.ts`, `lib/pay.ts`, `lib/arkiv.ts`, `lib/auth.ts`, `lib/server/http.ts`, the two existing pay routes, `test/test-mode.test.mjs` and the Arkiv SDK 1.0.1 source in `apps/web/node_modules/@arkiv-network/sdk/src`. I edited no code, made no network calls and sent no transactions. I didn't re-run tests (the caller has already verified them).

Two findings are HIGH, so the verdict is FAIL. Both fixes are small.

## Findings

### F1 HIGH: /fund relays a signature it never checked, so anyone can turn public POSTs into relayer traffic from our IP
- Where: `apps/web/lib/server/capital-fund.ts:23-35` (no signature check before `relayFunding`); `apps/web/lib/server/capital.ts:190-199` (`valid_before` only has to be above 0).
- Both existing relay paths verify the EIP-3009 signature on our server first, and check the 30 s to 15 min window, before the relayer sees anything: `app/api/v1/sessions/[id]/pay/route.ts:60`, `app/api/v1/invoices/[id]/pay/route.ts:60`, `lib/pay.ts:83`. `/fund` checks neither.
- Exploit sketch: copy any verified investor's address from InvestorRegistry's on-chain events, pick an open offer and a unit count worth at least 1 USDT, then POST `/api/v1/capital/fund` with `sig: "0x" + "11"*65`. No key is needed. Every request passes the web's checks (offer open, investor verified, units left, minimum) and goes out as `POST <RELAYER_URL>/relay` with `x-relay-secret`, from our server's IP. The relayer spends two RPC reads on it (`relayer.ts:474`, `prepareFunding`) and then rejects it with `bad_signature`. Rejections don't count toward `PAYER_SENDS_PER_HOUR`, which only counts sends, so the web's in-memory limit of 10/min per IP per instance is the only throttle. Security 020 F1 (HIGH) is the precedent: Vercel's IP-scoped burst mitigation has already fired on this relayer at probe volume. Once it challenges our IP, every `/relay` gets `403 x-vercel-mitigated`, which maps to BUSY, so every merchant checkout and invoice payment fails along with funding. The vector goes live as soon as one offer is open. Today both offers on chain are closed, so `/fund` answers 409 first.
- Fix: before `relayFunding`, rebuild the typed data and verify it the way `lib/pay.ts` does:
  - `nonce = keccak256(encodeAbiParameters([uint256, address, uint256, address, uint256, bytes32], [BigInt(whitechainSepolia.id), CAPITAL_MARKET, claimId, investor, units, salt]))`, the same as `CapitalMarket.fundingNonce` (`CapitalMarket.sol:255-261`).
  - `value` is the `quoteUnits` result you already read.
  - Call `verifyTypedData({ domain: usdtDomain, types: receiveTypes, primaryType: "ReceiveWithAuthorization", message: { from: investor, to: CAPITAL_MARKET, value, validAfter: 0n, validBefore, nonce }, address: investor, signature: sig })` and return 400 if it fails.
  - Also apply `lib/pay.ts`'s window rule (`now+30 < valid_before <= now+900`) in `parseFundBody`.
  - Add one test that a well-formed wrong signature gets 400 with `posts.length === 0`, and one nonce vector pinned against a live `fundingNonce` read.
- Owner: claude-relayer.

### F2 HIGH: `ownedBy(our publisher)` doesn't prove we wrote an Arkiv row, so anyone can disable Buy on any offer or on all of them
- Where: `apps/web/lib/server/capital-arkiv.ts:94-99` (the `rows()` filter); `:132` (`new Map(...)`, so the last row per claimId wins); `:151` (`.find`, so the first row wins); `:84` (`MAX_ROWS = 1000`).
- Why the filter fails: in Arkiv, ownership moves by a one-sided push. The current owner sends `TransferOwnership(entityKey, newOwner)` and the receiver does nothing (SDK `actions/wallet/changeOwnership.ts`, `entity/operations.ts:45`, `executeBatch` with `ownershipChanges`). The schema filter is just the name string `mcplus.offer.v1`, which anyone can write (`query/builderBase.ts:135-143`). `$creator` is set by the engine and can't be changed, and the SDK filters on it with `.createdBy()` (`query/builderBase.ts:123`). I read this in the SDK only and didn't run it on Rabdi.
- Exploit sketch:
  - Targeted: for an open claim X, the attacker creates an `mcplus.offer.v1` entity with `market = CapitalMarket`, `claimId = X` and a wrong `priceUsdt`, sets a long expiry, and transfers it to our publisher address. `rows()` now returns it. If it comes after ours in the result, the book's `Map` picks it, `matches` is false and Buy is disabled for X. Re-publishing doesn't help, because `syncOffer`'s `.find` patches whichever row comes first, which may be ours, while the book keeps reading the bad one.
  - Market-wide: the attacker pushes more than 1000 such entities, using `executeBatch` with creates plus `ownershipChanges` (keys are predictable to their creator). Our real entities drop out of the 1000-row page. Every offer shows `matches: false`, and each publish creates yet another duplicate. The cost is a few Rabdi testnet transactions.
- Integrity holds: no Arkiv content can make `matches` true for a fake offer, because `matches` (`:70-73`) compares every fixed term with the chain read for the same claimId. The damage is availability: false negatives on the Buy gate (FR-ARK-3).
- Fix: `reader.select().from(OfferEntity).where(eq("market", addr(CAPITAL_MARKET))).createdBy(address).ownedBy(address)`. Then pick a claim's row the same way in both places, for example a shared helper that prefers a row that `matches`. Update the comment at `:94`.
- Owner: claude-relayer.

### F3 MEDIUM: an authorization the relayer refuses as already used is reported as "Nothing was charged; please try again"
- Where: `apps/web/lib/server/capital-fund.ts:67-68`.
- Exploit sketch, here a user mistake rather than an attack: the investor double-clicks Buy, or the browser retries during the relayer's wait of up to 35 s. The second POST carries the same signature. Inside the send lock the relayer answers `422 replay` (`relayer.ts:409`, `sentAuthorizations`), or `422 would_revert` once the first one has landed. The web turns any 422 into "That approval didn't work. Nothing was charged; please try again." The investor believes it and signs again. A new salt makes a new `fundingNonce`, so they fund the offer twice. They get claim units for both payments, so nothing is stolen, but our server told them nothing was charged when it was. `lib/relay.ts` marks these cases `refused` so that its callers check the chain first. `/fund` doesn't.
- Fix: map `code === "replay"` to its own message ("This funding was already sent. Check your claims before you buy again."). For other 422s, read `USDT.authorizationState(investor, nonce)` (you have the nonce once F1 is fixed) before saying nothing was charged.
- Owner: claude-relayer.

### F4 MEDIUM: `/merchant` has no rate limit and nothing in the book is cached, so the Arkiv access key's quota can be drained, which disables Buy for everyone
- Where: `apps/web/app/api/v1/capital/merchant/route.ts:7-12`; `apps/web/lib/server/capital-arkiv.ts:120-139`.
- Any wallet gets a dashboard cookie: SIWE accepts any address (`app/api/auth/verify/route.ts`), and gas isn't needed to sign in. So the cookie on `/merchant` isn't a real gate, and the route is the heaviest one: `advanceOf` + `offers` + `outstanding`, then the whole `offerBook()` (`offerCount`, up to 200 `offers()` reads, and a 1000-row Arkiv query), with no limit at all. `/offers` is limited to 60/min per IP per instance, but every call still runs a fresh Arkiv query.
- Exploit sketch: sign in once and loop on `/merchant`, or spread `/offers` calls across a few IPs. The Arkiv access key's quota runs out, `rows()` throws, `offerRows` returns `[]`, and every offer shows `matches: false` until the quota resets. The Ankr public RPC that the web also uses for reads takes the same load.
- Fix: put `rateLimit(\`capital-read:${clientIp(request)}\`, 60, 60_000)` (or a per-merchant key) on `/merchant`. Cache `offerRows()` in the process for 10-15 s, single-flight like the relayer's `wbtBalance`, so Arkiv load stops growing with request volume. Optionally cache `chainOffers()` the same way.
- Owner: claude-relayer.

### F5 LOW: a no-op publish still costs an Arkiv write, and any wallet can trigger them
- Where: `apps/web/lib/server/capital-arkiv.ts:151-154`; `apps/web/app/api/v1/capital/offers/[id]/publish/route.ts:10`.
- Exploit sketch: any wallet runs `listAdvance` (anyone can list, `CapitalMarket.sol:103`), signs in, and POSTs publish 20 times a minute per instance. Each call is a `patchEntity` transaction paid by `ARKIV_PRIVATE_KEY` on Rabdi, even when nothing changed. Once that key runs out of tGLM, publish and the refresh after funding fail, and new offers never get `matches: true`.
- Fix: if the existing row's terms already equal `offerTerms(o, now)` (all 14 fields), return its key without writing. Lower the limit to about 5/min.
- Owner: claude-relayer.

### F6 LOW: an attacker can push live offers out of the 200-offer window
- Where: `apps/web/lib/server/capital.ts:71-80`.
- Exploit sketch: one wallet repeats `listAdvance` then `cancelOffer` (`CapitalMarket.sol:154-163` resets `advanceOf`), about 400 testnet transactions. `offerCount` moves 200 past every earlier offer, so those offers vanish from `/offers` and from the merchant's own view. Offers listed after the flood still show, so the attacker has to keep flooding. Read amplification isn't a problem: multicall3 is configured for 1874 in viem, so 200 reads take about 8 `eth_call`s.
- Fix, when it matters: scan back past cancelled and expired ids until there are 200 live offers or a read budget runs out (for example 1000 ids, cached as in F4), or build the book from `OfferListed` logs.
- Owner: claude-relayer.

### F7 LOW: Arkiv error details reach clients and logs, and the "never leaks" test doesn't test it
- Where: `apps/web/lib/server/capital-arkiv.ts:147,157,163` (up to 300 characters of the redacted viem message go back to the signed-in caller, including the Rabdi host, viem's version, request details, and with an empty key "ARKIV_PRIVATE_KEY is missing or malformed."); `apps/web/lib/server/capital-fund.ts:41` (logs `err.message`); `apps/web/test/capital-arkiv.test.mjs:54-62`.
- The redaction works: `redactArkivError` replaces both the raw and the `encodeURIComponent` form of the key (`rabdi()` puts `encodeURIComponent(key)` in the path), and it runs before the slice. The test, though, only asserts that one line was logged. `ARKIV_ACCESS_KEY` isn't set in the test, so redaction does nothing and `SECRET-KEY` actually goes into that log line.
- Fix: give clients fixed texts ("Arkiv isn't set up on this server." / "Arkiv refused or timed out. Try again.") and log the redacted detail on the server. At `capital-fund.ts:41`, log `err.name` (claude-contracts' LOW 3 too). In the test, set `process.env.ARKIV_ACCESS_KEY = "SECRET-KEY"` and assert `!logged[0].includes("SECRET-KEY")`.
- Owner: claude-relayer.

### F8 LOW: the FR-GW-14 exception is acceptable, but quoting the key slips past the scan
- Where: `apps/web/lib/server/capital-arkiv.ts:13-15,23,40,53,88`; `apps/web/test/test-mode.test.mjs:30`.
- Assessment: acceptable. All four quoted `"chainId"` uses are the schema type, the column kind, `CHAIN_ID = BigInt(whitechainSepolia.id)`, or `u64(t.chainId)` built from that value. It's descriptive metadata on the Arkiv entity, and nothing signs or reads with it. Arkiv's own chain is set separately by `rabdi()` in `lib/arkiv.ts`. `matches` also rejects any entity that names another chain (tested at `capital-arkiv.test.mjs:42`). Test 1 still catches a literal `1875` and any viem `whitechain` import.
- Residual risk: test 2's regex `[{,]\s*\bchain(?:Id)?:` doesn't match a quoted key at all, so a future `"chainId": someMainnet.id` anywhere in the app would pass silently.
- Fix: widen the regex to `[{,]\s*["']?chain(?:Id)?["']?\s*:\s*([\w."']+)` and allowlist exactly this file's forms (`u64`, `"u64"`, `CHAIN_ID.toString`), or scope the exception to `lib/server/capital-arkiv.ts`.
- Owner: claude-frontend (owns the test), coordinating with claude-relayer.

### F9 LOW (relayer, already there before this batch): a verified investor can trip the global breaker through the fund path
- Where: `apps/relayer/src/relayer.ts:44,156` (`BREAKER_REVERTS_PER_HOUR = 3` pauses all relaying), `:167-175` (`recordSend`).
- Exploit sketch: a verified investor POSTs a valid funding, then gets their own USDT transfer or `cancelAuthorization` mined between the relayer's in-lock simulation and inclusion. The relayer's transaction reverts, about 0.0024 WBT is spent, and that payer is banned. Three such wallets in an hour pause checkouts too. Only the registry owner can verify investors (`InvestorRegistry.setEligible` is `onlyOwner`), so the bar is high.
- Optional: on the web, refuse `investor === offer.merchant` with a 400 before relaying (`MerchantCannotFund`, `CapitalMarket.sol:305`) to save a round trip. Consider giving funding reverts their own breaker so they can't pause sales.
- Owner: claude-relayer.

## Answers to the focus questions
- **Gas for nothing, or funding without a signature?** Nobody can fund on someone else's behalf. The USDT signature binds `from = investor`, `to = CapitalMarket`, `value = quote` and `nonce = keccak256(chainid, market, claimId, investor, units, salt)`. `receiveWithAuthorization` only accepts calls from CapitalMarket, and the minting happens in the same transaction (`CapitalMarket.sol:176-204`). A ReceiveWithAuthorization signature can't be replayed as a `transferWithAuthorization`, because the typehash differs. Bad signatures don't spend gas either: the relayer recovers the signer and simulates before sending, and inside the lock it simulates again after the previous receipt, so two concurrent fundings of the same units can't both be mined. The only gas risk is F9. Unverified signatures still cost relayer reads and IP reputation (F1).
- **Different action or contract?** No. `action: "fund"` is a literal. The args are rebuilt from parsed bigints and addresses, so extra body keys are dropped. The relayer maps `fund` only to `CapitalMarket.fundWithAuthorization` at a fixed address. The URL is `new URL("/relay", RELAYER_URL)` and comes from the env.
- **Secret over https or loopback only?** Yes (`capital-fund.ts:52-53`). WHATWG `hostname` gives `[::1]` with brackets, so the set matches, and `localhost.evil.com` and `localhost.` fail it. `redirect: "manual"` means a 3xx turns into the 400 "didn't go through" message and is never followed. The secret is never logged.
- **Success without a valid txHash?** No. Success requires `res.ok` plus a 32-byte hex `txHash`. The relayer only sends 200 after a successful receipt. A 200 without a hash, any 5xx, or a timeout gives UNKNOWN ("don't pay again"). A 502 `reverted` also gives UNKNOWN, which is cautious and acceptable.
- **Publish another merchant's offer?** No. Publish returns 403 unless the chain says the session address is the offer's merchant (`capital-arkiv.ts:171`), and what gets written is always the chain's terms, never the caller's. Note that `matches: true` means "Arkiv mirrors the chain". It isn't an endorsement: any wallet can list on chain, sign in and publish its own offer. Fake terms can't produce `matches: true` (see F2). `ownedBy` alone can be spoofed for false negatives (F2).
- **Public reads?** Limited to 60/min per IP across offers, quote and transfer-check, using Vercel's overwritten `x-forwarded-for`, held in memory per instance (an existing ponytail). `/merchant` is unlimited (F4). The 200-offer window can be flooded (F6). No error text leaks the Arkiv key or an RPC secret: chain-read failures go through `handle()`, which returns a generic 500 and logs `err.name`. The Ankr URL is public and keyless. Arkiv messages are redacted but too detailed (F7).
- **Input parsing:** `uintField` allows at most 78 digits and at most 2^256−1, and `positive` rejects 0. `addressField` uses viem `isAddress`, which is strict, so a mixed-case address with a bad checksum is refused, and then `getAddress`. `salt` must be 32 bytes and `sig` 65 bytes of hex, and the relayer parses the signature again. `valid_after` must be exactly `"0"`. Missing: the `valid_before` window (F1). Bodies are capped at 16 KB.
- **FR-GW-14:** acceptable (F8).
- **Contract-side checks the web relies on:** the transfer-check order matches `ClaimToken.sol:198-207` (movable, sender, receiver, unfrozen), then the ERC-1155 balance, then `_fitsHolderCap` (`:263-266`). `quote` rounds up, at most 1 base unit in the merchant's favour, and price and face never change after listing, so the quote an investor signs can't move. Arkiv gets no PII: no debtor and no names, only the merchant address, which is already public on chain.

## Secret scan
Ran `git diff --name-only -z origin/main...HEAD | xargs -0 grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` over the 15 changed files. It found 2 hits, neither a secret:
- `apps/web/lib/server/capital-fund.ts:51`: `process.env.RELAY_API_SECRET`, an env variable name with no value.
- `apps/web/test/capital-arkiv.test.mjs:22`: the placeholder string `https://rabdi/SECRET-KEY` in a fake error.

No 64-hex value appears in the changed files. The address constants are 40-hex.

## Owners
claude-relayer: F1, F2 (both block the merge), then F3, F4, F5, F6, F7, F9. claude-frontend: F8 (the test regex), plus a note for the UI side of F3: when the server says the funding may already have been sent, the UI shouldn't offer an immediate retry.
