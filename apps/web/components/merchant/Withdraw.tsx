"use client";

// The money already in the merchant's wallet and a Withdraw form (FR-GW-15). Payments settle into this wallet in their
// own transaction, so there is no payout to wait for: the merchant's own wallet sends its USDT on, after a review step
// that shows the amount, the full address and the network fee. lib/withdraw.ts holds the checks and the transfer.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Address, Hex } from "viem";
import { Button } from "@/components/Button";
import { card, field, textLink } from "@/components/gateway/Frame";
import { formatWbt } from "@/lib/dashboard";
import { connectMerchant, type MerchantWallet } from "@/lib/merchant-wallet";
import { EXPLORER, formatUsdt, plainUsdt } from "@/lib/usdt";
import { MERCHANT_PAY, NOT_THROUGH, UNCONFIRMED, checkAmount, checkDestination, quoteWithdraw, sendStatus, withdraw, withdrawError } from "@/lib/withdraw";

interface WithdrawProps {
  merchant: Address;
  /** USDT units in the merchant's wallet (decimal string), read on chain by our server for this render; null = unread. */
  balance: string | null;
}

interface Review {
  wallet: MerchantWallet;
  to: Address;
  amount: bigint;
  fee: bigint; // WBT wei, estimated
  noChecksum: boolean; // typed all lower case: EIP-55 can't catch a typo (033 L1)
}

const txLink = (hash: Hex) => `${EXPLORER}/tx/${hash}`;
// ponytail: a second balance re-read after a send, for an RPC backend a block behind; poll the balance if 3 s isn't enough
const REREAD_MS = 3_000;

export function Withdraw({ merchant, balance }: WithdrawProps) {
  const units = balance === null ? null : BigInt(balance);
  return (
    <section aria-labelledby="your-usdt" className={`${card} lift`}>
      <p className="eyebrow text-ink-muted">Your money</p>
      <h2 id="your-usdt" className="flex flex-wrap items-baseline gap-x-3 text-[15px] font-medium">
        USDT in your wallet:
        <b className="text-[36px] leading-none font-medium tracking-[-0.03em] break-all tabular-nums md:text-[44px]">{units === null ? "—" : formatUsdt(units)}</b>
      </h2>
      <p className="max-w-[640px] text-sm text-ink-muted">
        Payments settle into this wallet in the same transaction the customer pays in. Nothing is held by us, so there&apos;s nothing to release or wait for.
      </p>
      <a href={`${EXPLORER}/address/${merchant}`} target="_blank" rel="noreferrer" className={`${textLink} data break-all`}>
        {merchant} on the explorer ↗
      </a>
      {/* always mounted, so a sent or pending withdraw stays on screen when the refresh reads 0 or nothing (033 M1) */}
      <WithdrawForm merchant={merchant} balance={units} />
      <p className="max-w-[640px] border-t border-hairline pt-4 text-xs text-ink-muted">
        Turning USDT into cash happens outside this app: send it to an account that can sell it, such as an exchange account&apos;s
        deposit address that accepts USDT on Whitechain. We never hold your funds, so we can&apos;t pay out cash for you.
      </p>
    </section>
  );
}

function WithdrawForm({ merchant, balance }: { merchant: Address; balance: bigint | null }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [toError, setToError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [sent, setSent] = useState<{ hash: Hex; amount: bigint; to: Address } | null>(null);
  const [pending, setPending] = useState<Hex | null>(null); // sent by the wallet, not confirmed yet

  /** The headline balance is our server's read: refresh now, and once more a few seconds later (041). */
  function reread() {
    router.refresh();
    setTimeout(() => router.refresh(), REREAD_MS);
  }

  function reset() {
    setSent(null);
    setError(null);
    setAmount("");
  }

  async function check(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || balance === null) return;
    const dest = checkDestination(to, merchant);
    const units = checkAmount(amount, balance);
    setToError(dest.ok ? null : dest.error);
    setAmountError(units.ok ? null : units.error);
    setError(null);
    if (!dest.ok || !units.ok) {
      document.getElementById(dest.ok ? "withdraw-amount" : "withdraw-to")?.focus(); // the first invalid field (041)
      return;
    }
    setBusy(true);
    try {
      const wallet = await connectMerchant(window.ethereum, merchant, MERCHANT_PAY); // the signed-in wallet, on chain 1874
      const fee = await quoteWithdraw(wallet, dest.value, units.value);
      setReview({ wallet, to: dest.value, amount: units.value, fee, noChecksum: to.trim() === to.trim().toLowerCase() });
    } catch (err) {
      setError(withdrawError(err));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (busy || !review) return;
    setBusy(true);
    setError(null);
    try {
      // the hash shows with its link as soon as the wallet returns it, not after the receipt (041)
      const hash = await withdraw(review.wallet, review.to, review.amount, setPending);
      setSent({ hash, amount: review.amount, to: review.to });
      setPending(null);
      setReview(null);
      reread();
    } catch (err) {
      setError(withdrawError(err));
      // a hash means it was sent and may still land: keep it linked, re-read the balance. Without one (refused before
      // sending, or the receipt says it reverted) nothing moved, so Send is offered again.
      if ((err as { hash?: Hex }).hash) reread();
      else setPending(null);
    } finally {
      setBusy(false);
    }
  }

  // ponytail: the pending hash lives in this page's state, so a reload forgets it; keep it in sessionStorage if that bites
  async function checkAgain() {
    if (busy || !review || !pending) return;
    setBusy(true);
    const status = await sendStatus(review.wallet, pending);
    if (status === "sent") {
      setSent({ hash: pending, amount: review.amount, to: review.to });
      setReview(null);
      setError(null);
    } else {
      setError(status === "failed" ? NOT_THROUGH : UNCONFIRMED);
    }
    if (status !== "pending") setPending(null);
    reread();
    setBusy(false);
  }

  if (sent) {
    return (
      <div role="status" className="grid gap-2">
        <p className="text-sm text-ink">
          Sent {formatUsdt(sent.amount)} USDT to <span className="data break-all">{sent.to}</span>.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <a href={txLink(sent.hash)} target="_blank" rel="noreferrer" className={textLink}>
            View transaction ↗
          </a>
          <Button variant="quiet" onClick={reset}>
            Withdraw again
          </Button>
        </div>
      </div>
    );
  }

  if (review) {
    return (
      <div className="grid gap-4">
        <h3 className="text-[15px] font-medium">Check before you sign</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
          <dt className="text-ink-muted">Amount</dt>
          <dd className="font-medium tabular-nums">{formatUsdt(review.amount)} USDT</dd>
          <dt className="text-ink-muted">To</dt>
          <dd className="data break-all">{review.to}</dd>
          <dt className="text-ink-muted">Network fee</dt>
          <dd className="tabular-nums">About {formatWbt(review.fee)} WBT, paid from this wallet</dd>
        </dl>
        <p className="text-sm text-ink-muted">
          A transfer can&apos;t be undone. Check the address matches the one you were given, every character.
          {review.noChecksum && " It was typed in lower case, which carries no checksum, so a typo wouldn't be caught."}
        </p>
        {pending && !error && (
          <p role="status" className="text-sm text-ink">
            Sent, waiting for confirmation…{" "}
            <a href={txLink(pending)} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
              View transaction ↗
            </a>
          </p>
        )}
        {/* once sent there is no Send and no Back: the receipt wait, then Check again if it can't be read (033 M2) */}
        <div className="flex flex-wrap items-center gap-2">
          {pending ? (
            error && (
              <Button onClick={checkAgain} aria-disabled={busy}>
                {busy ? "Checking…" : "Check again"}
              </Button>
            )
          ) : (
            <>
              <Button onClick={send} aria-disabled={busy}>
                {busy ? "Waiting for your wallet…" : "Send with my wallet"}
              </Button>
              <Button variant="quiet" onClick={() => setReview(null)} aria-disabled={busy}>
                Back
              </Button>
            </>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}{" "}
            {pending && (
              <a href={txLink(pending)} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
                View transaction ↗
              </a>
            )}
          </p>
        )}
      </div>
    );
  }

  if (balance === null) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" className="text-sm text-warning">
          Your wallet balance isn&apos;t available right now, so Withdraw is off.
        </p>
        <Button variant="quiet" onClick={() => router.refresh()}>
          Try again
        </Button>
      </div>
    );
  }
  if (balance === 0n) return <p className="text-sm text-ink-muted">Nothing to withdraw yet. Each payment lands here the moment it&apos;s paid.</p>;

  return (
    <form onSubmit={check} noValidate className="grid gap-4">
      <h3 className="text-[15px] font-medium">Withdraw</h3>
      <div className="grid gap-2">
        <label htmlFor="withdraw-to" className="text-sm text-ink-muted">
          Send to (wallet or exchange deposit address)
        </label>
        <input
          id="withdraw-to"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setToError(null);
          }}
          placeholder="0x…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={toError !== null}
          aria-describedby={toError ? "withdraw-to-error" : undefined}
          className={`${field} data`}
        />
        {toError && (
          <p id="withdraw-to-error" role="alert" className="text-sm text-critical">
            {toError}
          </p>
        )}
      </div>
      <div className="grid gap-2">
        <label htmlFor="withdraw-amount" className="text-sm text-ink-muted">
          Amount (USDT)
        </label>
        <div className="flex items-center gap-2">
          <input
            id="withdraw-amount"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setAmountError(null);
            }}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            aria-invalid={amountError !== null}
            aria-describedby={amountError ? "withdraw-amount-error withdraw-amount-hint" : "withdraw-amount-hint"}
            className={`${field} tabular-nums sm:max-w-[200px]`}
          />
          <Button
            variant="quiet"
            className="min-w-11 px-3"
            onClick={() => {
              setAmount(plainUsdt(balance)); // the exact balance, no rounding
              setAmountError(null);
            }}
          >
            Max
          </Button>
        </div>
        <p id="withdraw-amount-hint" className="text-sm text-ink-muted">
          Up to {formatUsdt(balance)} USDT. Your wallet pays a small network fee in WBT.
        </p>
        {amountError && (
          <p id="withdraw-amount-error" role="alert" className="text-sm text-critical">
            {amountError}
          </p>
        )}
      </div>
      <div>
        <Button type="submit" aria-disabled={busy}>
          {busy ? "Checking with your wallet…" : "Review withdraw"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </form>
  );
}
