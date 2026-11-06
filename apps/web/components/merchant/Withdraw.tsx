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
import { MERCHANT_PAY, checkAmount, checkDestination, quoteWithdraw, withdraw, withdrawError } from "@/lib/withdraw";

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
}

const txLink = (hash: Hex) => `${EXPLORER}/tx/${hash}`;

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
      {units === null ? (
        <p role="status" className="text-sm text-warning">
          Your wallet balance isn&apos;t available right now, so Withdraw is off. Reload the page in a minute.
        </p>
      ) : units === 0n ? (
        <p className="text-sm text-ink-muted">Nothing to withdraw yet. Each payment lands here the moment it&apos;s paid.</p>
      ) : (
        <WithdrawForm merchant={merchant} balance={units} />
      )}
      <p className="max-w-[640px] border-t border-hairline pt-4 text-xs text-ink-muted">
        Turning USDT into cash happens outside this app: send it to an account that can sell it, such as an exchange account&apos;s
        deposit address that accepts USDT on Whitechain. We never hold your funds, so we can&apos;t pay out cash for you.
      </p>
    </section>
  );
}

function WithdrawForm({ merchant, balance }: { merchant: Address; balance: bigint }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [toError, setToError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [sent, setSent] = useState<{ hash: Hex; amount: bigint; to: Address } | null>(null);
  const [unconfirmed, setUnconfirmed] = useState<Hex | null>(null);

  function reset() {
    setReview(null);
    setSent(null);
    setUnconfirmed(null);
    setError(null);
    setAmount("");
  }

  async function check(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const dest = checkDestination(to, merchant);
    const units = checkAmount(amount, balance);
    setToError(dest.ok ? null : dest.error);
    setAmountError(units.ok ? null : units.error);
    setError(null);
    if (!dest.ok || !units.ok) return;
    setBusy(true);
    try {
      const wallet = await connectMerchant(window.ethereum, merchant, MERCHANT_PAY); // the signed-in wallet, on chain 1874
      setReview({ wallet, to: dest.value, amount: units.value, fee: await quoteWithdraw(wallet, dest.value, units.value) });
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
      const hash = await withdraw(review.wallet, review.to, review.amount);
      setSent({ hash, amount: review.amount, to: review.to });
      setReview(null);
      router.refresh(); // re-read the balance on our server
    } catch (err) {
      setError(withdrawError(err));
      const hash = (err as { hash?: Hex }).hash;
      if (hash) {
        setUnconfirmed(hash); // it may still land: link it, and show the balance the chain has now
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
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
        <p className="text-sm text-ink-muted">A transfer can&apos;t be undone. Check the address matches the one you were given, every character.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={send} aria-disabled={busy || unconfirmed !== null}>
            {busy ? "Waiting for your wallet…" : "Send with my wallet"}
          </Button>
          <Button variant="quiet" onClick={unconfirmed ? reset : () => setReview(null)} aria-disabled={busy}>
            {unconfirmed ? "Close" : "Back"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}{" "}
            {unconfirmed && (
              <a href={txLink(unconfirmed)} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
                View transaction ↗
              </a>
            )}
          </p>
        )}
      </div>
    );
  }

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
          <p id="withdraw-to-error" className="text-sm text-critical">
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
          <p id="withdraw-amount-error" className="text-sm text-critical">
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
