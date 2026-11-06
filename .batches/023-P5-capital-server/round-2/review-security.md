VERDICT: PASS

# Security review: 023-P5-capital-server, round 2 (phase mode, Money: yes)

Scope: the round-1 fixes at `4db17af` (tests `5c15fcf`, fixes `d8dd9a5`), re-read in full: `apps/web/lib/server/capital.ts`, `capital-fund.ts`, `capital-arkiv.ts`, `apps/web/app/api/v1/capital/merchant/route.ts`, and the test diffs in `test/capital-fund.test.mjs` and `test/capital-arkiv.test.mjs`. For context I checked `packages/shared/contracts.ts` (the USDT domain and types), `contracts/src/CapitalMarket.sol:255-261` (`fundingNonce`) and viem's root export of `verifyTypedData`. The rest of the merge from origin/main (docs pages, SRS, CAPITAL-TAB.md) is outside this batch, and I only ran the secret scan on the batch's own files. I edited no code, made no network calls and sent no transactions. I didn't re-run tests; the coordinator reports 514 pass / 0 fail, typecheck 0, eslint 0.

Both HIGHs are fixed. Nothing CRITICAL, HIGH or MEDIUM is left. Two LOW residuals and the three deferred items are below; none of them blocks.

## Round-1 findings, re-checked

- **F1 HIGH: fixed.** `capital-fund.ts:31-34` refuses a `valid_before` outside the relayer's window before any read. That's `<= now+30` or `> now+900`, which is 1 s stricter than `relayer.ts` `tooLate` at the bottom end and the same at the top. `:43-48` rebuilds the authorization: `from = investor`, `to = CAPITAL_MARKET`, `value =` the quote just read, `validAfter = 0`, `nonce = fundingNonce(...)`. It then runs viem's local `verifyTypedData`, the `utils/signature` version (recovers the signer, no RPC, no ERC-1271/6492 path), and on failure returns 400 before `relayFunding`.
  - `fundingNonce` (`capital.ts:155-159`) encodes `(uint256 chainid, address market, uint256 claimId, address investor, uint256 units, bytes32 salt)`, which matches `abi.encode(block.chainid, address(this), claimId, investor, units, salt)` at `CapitalMarket.sol:260`.
  - The web's `usdtDomain` and `receiveTypes` (`lib/usdt.ts:10-21`) equal `packages/shared` `usdtDomain` and `receiveWithAuthorizationTypes`, which the relayer verifies with.
  - The tests sign with a key generated at runtime (no key in the repo) and restate the nonce independently. They check four forged cases: a junk signature, a different signer, different units and a different value. Each returns 400 with zero posts to the relayer, and the window cases are refused before any read.
  - A junk POST now costs us three chain reads and never reaches the relayer, so the round-1 path to Vercel's burst block is closed.
- **F2 HIGH: fixed.** `capital-arkiv.ts:100` filters `.ownedBy(address).createdBy(address)`. `$creator` is set by the engine and can't be changed, which claude-contracts confirmed at 10:49 from the SDK's own d.ts ("The creator never changes; the owner does"). A planted entity is out of the result whatever its owner. `rowFor` (`:145-148`) is the single rule for the book (`:158`) and for `syncOffer` (`:180`): it prefers a row that matches the chain, otherwise takes the first. Duplicates can now only come from our own races, and both paths pick the same row (tested in `capital-arkiv.test.mjs:85-94`).
- **F3 MEDIUM: fixed.** `capital-fund.ts:83` maps relayer `422 replay` to 409 "This funding was already sent. Check your claims before signing again." (tested). On a multi-instance relayer, a second POST after the first was mined also comes back as `replay` (from `authorizationState` in `rpcChecks`). If the investor cancelled the authorization themselves, "check your claims" is still the safe advice.
- **F4 MEDIUM: fixed for its stated impact.** `/merchant` now has a limit of 30/min per merchant (`merchant/route.ts:10`). The live Arkiv rows are cached for 10 s and single-flight (`capital-arkiv.ts:120-132`). A failed read isn't cached, because `.catch` clears its own entry, and a synchronous `arkivClients()` throw is caught in `offerRows`. Our writes invalidate the cache (`:191`, `:202`). Book traffic now costs at most about 6 Arkiv queries a minute per instance, whatever the request volume, so the attack that turned Buy off by draining the Arkiv quota is gone. The cached rows are public mirror data shared across callers, and only our own entities can get into them, so they can't be poisoned. See R1 for what's left.
- **F5 LOW: fixed.** `sameTerms` (`:150`) compares all 14 columns, and an unchanged offer isn't patched (tested: zero writes). If the SDK's row mapping were ever off, it would just fall back to patching, which is no worse than round 1.
- **F7 LOW: fixed.** Clients get only fixed texts (`:171`, `:176`); the SDK text goes to the log, redacted (`:170`, `:175`). The refresh after funding logs through `redactArkivError` too (`capital-fund.ts:55`). The test now sets `ARKIV_ACCESS_KEY` and asserts the log doesn't contain it (`capital-arkiv.test.mjs:57,63`), and a new test asserts that a 502 carries no SDK text.
- **F6, F8, F9: deferred, as logged in `batch.md` at 10:58.** I accept the deferral. All three are LOW: F6 costs about 400 testnet transactions per flood, F8 is a guard-regex gap with today's values correct, and F9 needs admin-verified investors and was already there before this batch.

## Residual findings (LOW, don't block)

### R1 LOW: `/merchant` is limited per merchant address, and chain reads aren't cached
- Where: `apps/web/app/api/v1/capital/merchant/route.ts:10`; `apps/web/lib/server/capital.ts:74-80`.
- Scenario: SIWE accepts any wallet and signing in is free, so a script can sign in with N fresh wallets and get 30N `/merchant` calls a minute. Each call still runs `advanceOf` + `offers` + `outstanding` and the whole uncached `chainOffers()`, about 8 multicall `eth_call`s, against the public Ankr endpoint the web also uses for its other reads. Arkiv is protected now; Ankr's rate limit on our egress IP is what's left.
- Fix, when it matters: key the limit on `clientIp(request)` as well, or cache `chainOffers()` for 5-10 s the same way as `liveRows`.
- Owner: claude-relayer.

### R2 LOW: one wallet can still make our key create Arkiv entities, toward the 1000-row page
- Where: `apps/web/lib/server/capital-arkiv.ts:195-203` (create), `:100` (`limit(MAX_ROWS)` over every claim); `apps/web/app/api/v1/capital/offers/[id]/publish/route.ts:10` (still 20/min).
- Scenario: one wallet repeats `listAdvance` with a far deadline (within Arkiv's maximum expiry), publish, then `cancelOffer`. That's 2 Whitechain testnet transactions plus 1 publish per loop. Each loop makes our `ARKIV_PRIVATE_KEY` create an entity that lives until the attacker's deadline and still says `status: open` after the cancel. After about 1000 loops (about 50 minutes at 20 publishes a minute), our own rows can overflow the 1000-row page. Real offers' rows might then drop out (Buy fails closed) and publish could create duplicates. This is the F6 flood again, but costlier (it needs SIWE and our rate limit), and F6 is already deferred.
- Fix, with F6: scope the rows query to the claims the book reads, `where(and(eq("market", …), gte("claimId", u64(first))))`. That's at most about 200 rows, so the page can't overflow. Also consider lowering publish to about 5/min.
- Owner: claude-relayer.

## Secret scan
Ran `git diff --name-only -z origin/main...HEAD | xargs -0 grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` over the 16 batch files, and again over the files changed in `e6f55e2..4db17af` under `apps/web/lib/server`, `app/api/v1/capital` and the two capital tests. There are no secrets:
- `apps/web/lib/server/capital-fund.ts:65`: `process.env.RELAY_API_SECRET`, an env variable name only.
- `apps/web/test/capital-arkiv.test.mjs:22,57,63`: the placeholder `SECRET-KEY`, used for the redaction test.
- `.batches/023-P5-capital-server/round-1/review-security.md:48,59-61,89-91`: my own review text, which names `ARKIV_PRIVATE_KEY` and the pattern.

The test investor key comes from `generatePrivateKey()` at runtime and isn't written down anywhere. None of these files contains a 64-hex literal.

## Owners
claude-relayer: R1 and R2 (optional, with F6), then F6 and F9 as planned. claude-frontend: F8 (the guard regex), as planned.
