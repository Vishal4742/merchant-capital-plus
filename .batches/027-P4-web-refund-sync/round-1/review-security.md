VERDICT: PASS

# Security review: 027-P4-web-refund-sync, round 1 (phase mode, Money: yes)

Scope: `git diff HEAD~2 HEAD -- apps/web` (2740058, d2f9a90): lib/refund-sync.ts (new), test/refund-sync.test.mjs (new),
lib/merchant-wallet.ts (refund() returns the tx hash), components/merchant/Refund.tsx (calls syncRefund after the receipt).
Server route app/api/v1/payments/[id]/refunds/sync/route.ts and lib/server/refunds.ts (claude-contracts) read only for how
the client uses them. No HIGH or CRITICAL findings.

## The four questions asked

1. **Can the change cause a double refund?** No. The refund tx is sent once (merchant-wallet.ts:177, unchanged send()).
   syncRefund can't throw: a rejected fetch is mapped to a status (refund-sync.ts:23-26), so the `catch` in Refund.tsx:73-74
   (the only path that leaves a resubmittable form) can't run once refund() has returned. The unsynced notice
   (Refund.tsx:80-91) has no form, only Close, and Close calls done() → router.refresh(), which re-keys the control by the
   new on-chain `left` (app/merchant/page.tsx:319, payments/page.tsx:147). While the sync runs, `busy` blocks a second
   submit (Refund.tsx:57) and Button ignores clicks on aria-disabled Close (components/Button.tsx:28-30). MerchantPay still
   caps cumulative refunds at gross (RefundTooLarge).
2. **A refund reported as failed after money moved?** Not by this change: a failed sync shows "Refunded. The webhook to
   your server didn't go out yet." The one remaining path is pre-existing and outside this diff, see F1.
3. **Retries that amplify load?** No. At most 3 sequential POSTs per refund click, only on 502 or a network error, 1.5 s
   apart (refund-sync.ts:5-7, 27-29); 400/401/404/429/500/503/504 stop at once. Server side each POST is one
   listPayments query plus at most 3 receipt reads (refunds.ts:13-16, 33-42), and the 30/min/merchant limit counts the
   retries (route.ts:8, 13). A retry after a lost response, or one that overlaps a still-running server request, can't send
   payment.refunded twice: the key `refund:<session>:<totalRefunded>` is claimed with `INSERT ... ON CONFLICT DO NOTHING`
   (events.ts:39, 61) and the event id is derived from that key (events.ts:34).
4. **Anything sent to the wrong origin?** No. The URL is relative (refund-sync.ts:19), so same origin; default
   `credentials: "same-origin"` sends the SIWE cookie only there; /merchant's CSP keeps `connect-src 'self'` (+ the Nym
   hosts) (next.config.ts:31-34, 54); there's no middleware or redirect that could bounce the POST. `paymentId` is
   server-rendered chain/DB data and has already been through `BigInt()` (Refund.tsx:68) before the fetch. The body is
   `{tx_hash}` only: no PII, nothing logged client-side.

Server trust (for the record): the route takes the tx hash only as a pointer; refunds.ts:61-69 checks the payment is
the signed-in merchant's, the receipt succeeded, and the log is MerchantPay's own Refunded for this payment id. A
wrong or forged hash can only get a 400/404 back.

## Secret scan
`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the four diff files and over the diff itself: no hits (exit 1).
The test's tx hash is built at runtime (`0x${"ab".repeat(32)}`), so no literal shows up.

## Tests
`node --experimental-test-module-mocks --test test/refund-sync.test.mjs`: 8 tests, 8 pass, 0 fail.

## FOLLOW-UP (non-blocking)

**F1 MEDIUM (pre-existing, not introduced here): a receipt-wait failure after the refund was broadcast shows a retryable
error.** lib/merchant-wallet.ts:139-144 (send), components/merchant/Refund.tsx:73-74.
Sketch: writeContract returns a hash, then waitForTransactionReceipt throws (viem 2.57 default timeout 180 s, or the
wallet's RPC fails while polling). walletError gives "Your wallet couldn't send this... try again", the form stays open
with the old `left` and no refresh. The merchant clicks Refund again, both txs mine, and the customer gets 2x the intended
partial refund (still capped at gross by MerchantPay).
Fix: once a hash exists, a receipt-read failure throws a distinct "sent, not confirmed" error carrying the hash.
Refund.tsx then shows "Refund sent. Check the table before refunding again" and calls router.refresh() instead of the
form. Owner: claude-frontend.

**F2 LOW: a misleading notice for payments with no checkout record.** refund-sync.ts:27-28, Refund.tsx:84.
The dashboard lists chain payments that have no gateway session (refunds.ts:61-62 404s for them, e.g. invoice
payments; page.tsx:188-189 merges in the chain's rows). Refunding one shows "The webhook to your server didn't go out
yet", but no webhook will ever be sent for it. No money impact. Fix: return the status (or a tri-state) and say nothing on
404, or only sync rows that have a session. Owner: claude-frontend.

**F3 LOW: "Refunding…" stays up through the sync.** Refund.tsx:66-77; worst case per POST server side is about 32 s
(3 reads x 10 s timeout + gaps, refunds.ts:13-16), so up to about 1.5 min after the money has moved, with Close disabled.
A merchant who reloads sees the new on-chain `left`, so this doesn't lead to a double refund, but the label is wrong.
Fix: switch the label to something like "Refunded. Telling your server…" once refund() returns. Owner: claude-frontend.
