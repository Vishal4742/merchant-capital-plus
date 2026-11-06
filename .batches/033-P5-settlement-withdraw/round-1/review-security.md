VERDICT: PASS

# Security review: 033-P5-settlement-withdraw, round 1 (phase mode, Money: yes, PIPELINE.md §3b.2)

Reviewer: reviewer-security. Diff: `git diff origin/main...HEAD -- apps/web` on p5-settlement-withdraw (head c9744d8):
apps/web/lib/withdraw.ts (new), apps/web/components/merchant/Withdraw.tsx (new), apps/web/app/merchant/settlements/page.tsx,
apps/web/test/withdraw.test.mjs. Read: spec.md, batch.md, round-1/ci.md, lib/merchant-wallet.ts, lib/usdt.ts, lib/onchain.ts
(readUsdtBalance), components/Button.tsx, packages/shared/contracts.ts, next.config.ts headers, viem 2.57.13 sources
(isAddress, waitForTransactionReceipt, sendTransaction). No build-*.md files in this batch. No code edited, no transaction sent,
no .env read.

No HIGH or CRITICAL findings. Three MEDIUM and three LOW, all under FOLLOW-UP.

## What was checked and holds

- **Who can move funds.** No server route and no relayer call. The only transfer is `USDT.transfer(to, amount)` signed by the
  injected wallet. `connectMerchant` (unchanged) refuses any account other than the session's merchant
  (merchant-wallet.ts `connectMerchant`), and the tx `from` is that account. A non-merchant can only ever sign away their own
  USDT. The page renders Withdraw only after `currentMerchant()` (page.tsx:52-53). `merchant` and `balance` are server values.
  Nothing comes from query params, so a crafted link can't prefill the destination or amount.
- **Amount is exact.** `parseUsdt` is regex `^\d+(\.\d{1,6})?$` (ASCII digits only, no sign, no exponent) followed by
  `parseUnits`. No floats anywhere. Max uses `plainUsdt(balance)`, which round-trips exactly (test "Max fills the exact
  balance", 4 balances). The review shows `formatUsdt(review.amount)` (never rounded, up to 6 decimals), and the value shown is
  the bigint that gets sent. Above-balance is refused in the form and again by the dry run against chain state
  (withdraw.ts:75).
- **Destination.** Trimmed, strict hex regex (catches zero-width chars and homoglyphs), EIP-55 strict for mixed or upper case
  (withdraw.ts:38), zero address, own address and MerchantPay/CapitalMarket/USDT all refused case-insensitively. The address
  is returned as `getAddress()` output, and that same value is both shown in the review and sent.
- **Stale review.** The inputs aren't rendered during review. `send()` uses only `review.to`/`review.amount`, captured after
  validation, and those are the values on screen. Back goes back through the full checks again. Typing during the async
  `check()` can't change what gets reviewed.
- **Double submit.** `busy` is set synchronously before any await in `check()` and `send()`. React flushes discrete-event
  updates before the next click, and `Button` drops `onClick` while aria-disabled. The submit button's form-submit path is
  covered by the `if (busy) return` guard. The wallet prompt is a second gate.
- **Unconfirmed send.** A receipt that can't be read, or the 180 s viem default timeout, throws `SENT_UNCONFIRMED` with the
  hash. Send stays aria-disabled while `unconfirmed` is set (Withdraw.tsx:156), the tx link shows, and the balance is re-read.
  A reverted receipt says nothing moved, which is true for a reverted transfer. See M2 for what happens after Close.
- **Wrong chain.** `connectMerchant` switches/adds 1874, `withdraw()` re-reads `eth_chainId` before the dry run
  (withdraw.ts:74), and viem `sendTransaction` runs `assertCurrentChain` again. The signed tx is EIP-155 bound.
- **XSS.** Everything is rendered as React text. hrefs are `${EXPLORER}/address/${merchant}` and `${EXPLORER}/tx/${hash}`
  with a fixed https prefix, so no scheme injection even if a wallet returns an odd hash string. No dangerouslySetInnerHTML.
- **Clickjacking.** next.config.ts sets `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- **Financing invariants.** No contract pulls USDT from the merchant's wallet except the merchant's own refund (exact-amount
  approve). Withdrawing can't break a lien, distribution or recourse path (CapitalMarket.sol has no transferFrom(merchant)).
- **Privacy/trackers.** A plain ERC-20 transfer with no memo. Nothing new goes to Arkiv. No new third-party script.
  No console logging.
- **Tests.** `node --experimental-test-module-mocks --test test/withdraw.test.mjs`: 12 pass, 0 fail (run by this reviewer).
  AT-18 checks exactly one `transfer(EXCHANGE, 1_000_000)` from the merchant to USDT.

## Secret grep

`git diff --name-only origin/main...HEAD | xargs grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'`:
one hit, `.batches/033-P5-settlement-withdraw/round-1/ci.md:71`, "dummy AUTH_SECRET". That's the env var's name in prose,
not a value. No hits in apps/web files (the test's 32-byte hex values are built with `.repeat()`, not literals). Clean.

## FOLLOW-UP

**M1 (MEDIUM): the success message and tx link vanish after a Max withdraw.** Withdraw.tsx:46-54 and :111. Owner:
claude-frontend (or this lane's next batch).
Sketch: the merchant presses Max and sends. `router.refresh()` re-reads the balance as 0, so `Withdraw` swaps `<WithdrawForm>`
for "Nothing to withdraw yet". The form unmounts and its `sent` state, with the "Sent X USDT" message and the
"View transaction" link, is lost. A balance re-read that fails (null) does the same, on both the success and the unconfirmed
path. Funds aren't at risk (with a 0 or unread balance no second send is possible), but the spec's "On success: the tx link
shows" fails for any withdraw that empties the wallet, and the merchant loses their proof of the send.
Fix: always mount `WithdrawForm` (pass `balance` and let it show the 0/unread copy itself), or lift `sent`/`unconfirmed`
into `Withdraw`.

**M2 (MEDIUM): Close after an unconfirmed send allows a second send while the first can still land.** Withdraw.tsx:75-81
and :159. Owner: claude-frontend.
Sketch: the receipt read fails (Nym/RPC hiccup) or the 180 s timeout passes while tx A is still pending. The merchant sees
UNCONFIRMED, clicks Close (`reset()` clears `unconfirmed`, keeps `to`), types the amount again, reviews and signs. The
server-read balance still includes A's amount, so the form check, the fee estimate and the dry run all pass. The wallet signs
B at nonce+1. If the balance is at least 2x the amount, both land and the merchant sends twice to the same address. No
attacker gains anything (it's the merchant's own funds going to their own destination), but it's the double send this
review was asked to watch for.
Fix: keep the pending hash past Close, in component state above the form (see M1) or sessionStorage keyed by merchant. On the
next Review, `getTransactionReceipt(hash)`: while it's still pending, refuse with the UNCONFIRMED copy and the link. Clear it
once the receipt reads. Optionally compare `getTransactionCount(merchant, "pending")` with `"latest"` and refuse while
they differ.

**M3 (MEDIUM): ClaimToken and InvestorRegistry are not refused as destinations.** withdraw.ts:16-20. Owner: this lane /
claude-frontend.
Sketch: packages/shared/contracts.ts also lists claimToken (0xce9b…c388) and investorRegistry (0x2934…4e74). Neither has
any ERC-20 rescue (contracts/src/ClaimToken.sol, InvestorRegistry.sol), so USDT a merchant pastes there by mistake is lost
for good. The spec lists only three, which is why this isn't blocking.
Fix: add both to `CONTRACTS` and pin them in the test's address-match check. Better: before the review, `getCode(to)` and
show a warning (not a refusal, since a Safe or smart-wallet deposit address is a contract) when the destination has code.

**L1 (LOW): an all-lower-case address gets no typo protection.** withdraw.ts:38. Standard EIP-55 behaviour: lower case
carries no checksum, so a one-character typo passes. Fix: in the review, add "This address has no checksum, so check every
character" when `typed === typed.toLowerCase()`. Owner: claude-frontend.

**L2 (LOW): the dry run's `transfer` return value is ignored.** withdraw.ts:75. TetherTokenV2 reverts on failure, so this
isn't exploitable today. A token that returns `false` would show "Sent" while nothing moved. Fix: refuse when
`simulateContract(...).result !== true`. Owner: this lane.

**L3 (LOW): a wallet error after broadcast leaves Send enabled.** Withdraw.tsx:113-118. If a wallet (e.g. a remote signer)
broadcasts and then rejects the request without returning a hash, the page says "couldn't send" and Send stays active.
Inherited from merchant-wallet `send()` and rare with an injected wallet. M2's pending-nonce check would cover this too.
Owner: claude-frontend.
