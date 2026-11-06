# Spec: 033-P5-settlement-withdraw

## Requirements (cite docs/SRS.md IDs)
- FR-GW-15 (settlement balance and withdraw): Settlements shows the USDT already in the merchant's own wallet (it settled
  in each payment's own transaction; nothing is pending with us) and a Withdraw action: the merchant's injected wallet
  sends USDT (ERC-20 transfer, 0xcedfb56113143d55b2358b8cfbb0deb5ad2f55a7) to an address it enters, with the amount, the
  full address and the network fee estimate shown before it signs.
- FR-GW-10 (settlements, T+0): unchanged; the new balance block sits above the existing list and states that payments
  settle into this wallet in the same transaction.

## Acceptance criteria (cite AT-… where one exists; each must be checkable)
- [ ] AT-18: the merchant opens Settlements and withdraws 1 USDT to a second address; the balance matches the chain
      (read server-side with lib/onchain.ts readUsdtBalance) and the withdraw tx moves exactly 1 USDT (1_000_000 base
      units) to that address. In this batch: checked by unit tests on a fake wallet; no real transaction is sent.
- [ ] The top of /merchant/settlements reads "USDT in your wallet: X", says payments settle into this wallet in the same
      transaction and nothing is held by us, and links the address on https://explorer.testnet.whitechain.io.
- [ ] Destination refusals, each with its own plain message (unit-tested): empty, not an address, bad checksum (mixed
      case that isn't EIP-55), the zero address, the merchant's own address, MerchantPay, CapitalMarket, USDT.
- [ ] Amount refusals (unit-tested, bigint base units, no floats): not a number or more than 6 decimals, 0, above the
      balance. Max fills the exact balance.
- [ ] Before signing the form shows the amount, the full checksummed address and the network fee estimate (WBT).
- [ ] Plain errors: rejected in the wallet, not enough WBT for gas, wrong network, sent but unconfirmed (SENT_UNCONFIRMED).
- [ ] On success: the tx link shows and the balance is re-read (router.refresh()).
- [ ] The page says turning USDT into cash happens outside the app (for example an exchange account); we never hold funds.
- [ ] typecheck, lint, web tests and build pass (round-1/ci.md).

## Files to touch (owner lane: only these)
- apps/web/app/merchant/settlements/page.tsx
- apps/web/lib/withdraw.ts (new: validation, amount parsing, transfer, error copy)
- apps/web/components/merchant/Withdraw.tsx (new: balance block + form, client)
- apps/web/test/withdraw.test.mjs (new)

## Ponytail ladder (why this is the smallest change that works)
- Needed: yes (human 16:16, SRS v2.2). Already in repo: readUsdtBalance (server balance read), parseUsdt/formatUsdt
  (bigint amounts), formatWbt, connectMerchant (account check, switch/add chain 1874), SENT_UNCONFIRMED and walletError
  from lib/merchant-wallet.ts, all used unchanged. merchant-wallet's send() isn't exported, so lib/withdraw.ts repeats its
  three steps (simulate, write, wait for the receipt) for the one transfer call rather than editing that file. viem
  isAddress(strict) does the EIP-55 check. No server route: router.refresh() re-reads the balance on the server.

## Out of scope
- lib/merchant-wallet.ts and components/gateway/Settlements.tsx (its "Wallet balance" card stays; dropping it so the
  balance isn't shown twice is a follow-up for claude-frontend).
- Any off-ramp to cash, any custody, any relayer-paid withdraw (the merchant pays its own WBT gas, as for refunds).
