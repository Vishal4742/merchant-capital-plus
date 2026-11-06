# Spec: 042-P5-withdraw-followup

## Requirements (cite docs/SRS.md IDs)
- FR-GW-15 (settlement balance and withdraw): follow-ups from claude-frontend's UX review of PR #30. The merchant sees the
  transaction as soon as the wallet sends it, and the headline balance re-reads once it is confirmed.
- AT-18: "the balance matches the chain; the withdraw tx moves exactly 1 USDT to that address". The re-read after Sent
  is part of "the balance matches the chain".

## Acceptance criteria (each must be checkable)
- [ ] `withdraw(w, to, amount, onSent)` calls `onSent(hash)` as soon as the wallet returns the hash, before any receipt
      read; it is not called when the dry run refuses (unit tests, written first).
- [ ] While the receipt is awaited the review shows "Sent, waiting for confirmation…" with the explorer link, and no
      Send or Back. Then it shows the confirmed state (tx link). A receipt that can't be read leaves the UNCONFIRMED
      message, the link and Check again.
- [ ] After Sent the page calls router.refresh() at once and again a few seconds later, so the headline "USDT in your
      wallet" re-reads even from an RPC backend a block behind.
- [ ] Field errors are announced: `role="alert"` on each field error, already tied by aria-describedby. Focus moves to
      the first invalid field.
- [ ] WRONG_NETWORK says "Whitechain Testnet (chain 1874)", not "Sepolia".
- [ ] Max is at least 44 × 44 px.
- [ ] The balance-unreadable state has a "Try again" button (router.refresh()).
- [ ] typecheck, lint, web tests and build pass (round-1/ci.md).

## Files to touch
- apps/web/lib/withdraw.ts, apps/web/components/merchant/Withdraw.tsx, apps/web/test/withdraw.test.mjs

## Ponytail ladder
- Needed: yes (UX review MEDIUM 1). One optional callback on withdraw() instead of splitting send and wait into two
  exported calls; one state field for the hash of a sent but unconfirmed transfer (it replaces `unconfirmed`).

## Out of scope
- lib/merchant-wallet.ts (unchanged). The real AT-18 testnet run (human). UX MEDIUM 2 (balance drop on a real send):
  covered by the AT-18 run, and this batch makes the re-read happen twice.
