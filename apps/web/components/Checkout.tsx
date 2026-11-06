"use client";

// The customer's checkout sheet (FR-PAY-5, FR-PAY-7, FR-PAY-9). Plain words only: no "sign", "gas",
// "wallet" or chain names. Press and hold to pay (human pick); the guest key signs in the browser and our
// server checks and relays it. Batch 006: the FX line, a countdown, named states, "Back to <shop>".
// Batch 015: a discount code on link and page checkouts (FR-GW-12). The payer approves the amount due as our server
// reads it right before approving, never one remembered here.
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Address, Hex } from "viem";
import { Confirming } from "@/components/Confirming";
import { HoldButton } from "@/components/HoldButton";
import { FAILED, NOT_FUNDED, outcome, type PayAnswer } from "@/lib/outcome";
import { EXPLORER } from "@/lib/usdt";

// The relayer wants an approval to stay valid at least 30 s (lib/pay.ts), and an approval ends with the checkout: in
// its last 30 s a checkout can't be paid, so the sheet counts down to that moment.
const LAST_PAYABLE_MS = 30_000;

// A one-second clock for the countdown. null while server rendering, so the sheet hydrates without a clock mismatch.
const subscribeSeconds = (tick: () => void) => {
  const id = window.setInterval(tick, 1000);
  return () => window.clearInterval(id);
};
const thisSecond = () => Math.floor(Date.now() / 1000) * 1000;
const useNow = () => useSyncExternalStore(subscribeSeconds, thisSecond, () => null);
const mmss = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

// The signer (viem + the guest key) loads after first paint, so it never slows the sheet (NFR-12).
type Signer = typeof import("@/lib/sign-sale");
const loadSigner = () => import("@/lib/sign-sale");

interface CheckoutProps {
  sessionId: string;
  merchantName: string;
  reference: string;
  items: { name: string; qty: number; price: string }[];
  /** What the customer pays now (after any discount code), or paid. */
  amountText: string;
  /** A link or page checkout takes a discount code; null for a shop's own checkout. Server-rendered: the total before
   *  any code, and the discount now held (null without one). */
  code: { totalText: string; discountText: string | null } | null;
  /** Server-rendered for a checkout priced in another currency: "20.00 EUR = 22.51 USDT · 1 USD = 0.88875 EUR, rate of 6 Nov 2026 · 1 USDT = 1 USD". */
  fxLine: string | null;
  /** The shop's page to go back to (http/https, checked when the shop created the checkout). */
  returnUrl: string | null;
  /** Null until MerchantPay and the relayer are configured on the server. */
  sale: { merchantPay: Address; merchant: Address; orderRef: Hex; amount: string } | null;
  expiresAt: number;
  paid: boolean;
  /** An earlier attempt's outcome is still unknown (the server settles it from the chain). */
  pending: boolean;
}

type Receipt = { receiptId: string; txHash: Hex | null };
// confirming: an attempt's outcome is unknown, here or on the server. It wins over "expired": that customer may
// already have paid, so they must never be sent to a new checkout (security R1 S1), and it never offers the
// button again (002 security D4).
type Phase = "ready" | "confirming" | "expired";

const pill = "rounded-pill border border-current px-3 py-0.5 text-xs font-medium tracking-wide whitespace-nowrap";

/** The sheet already shows what happened (confirming or expired): no extra error line. */
class Shown extends Error {}

const CODE_FAILED = "We couldn't check that code. Try again.";
type Due = { amountText: string; discountText: string | null };
// the code route sends plain decimals ("1000.00"); the sheet groups thousands like the server-rendered amounts
const grouped = (plain: string) => plain.replace(/^\d+/, (whole) => Number(whole).toLocaleString("en-US"));
const dueFrom = (data: { amountDue: string; discount: string }): Due => ({ amountText: grouped(data.amountDue), discountText: /^0+(\.0+)?$/.test(data.discount) ? null : grouped(data.discount) });

export function Checkout({ sessionId, merchantName, reference, items, amountText, code, fxLine, returnUrl, sale, expiresAt, paid, pending }: CheckoutProps) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [due, setDue] = useState<Due>({ amountText, discountText: code?.discountText ?? null });
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeOpenAtStart] = useState(() => Boolean(code?.discountText)); // then the payer opens and closes it
  const focusAfterCode = useRef(false);
  const codeInput = useRef<HTMLInputElement>(null);
  const removeButton = useRef<HTMLButtonElement>(null);
  const hasDiscount = due.discountText !== null;
  useEffect(() => {
    if (!focusAfterCode.current) return;
    focusAfterCode.current = false; // the control the payer used is gone: move focus to the one that replaced it
    (hasDiscount ? removeButton : codeInput).current?.focus();
  }, [hasDiscount]);
  const [paying, setPaying] = useState(false);
  const now = useNow();
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(() => (pending ? "confirming" : Date.now() > expiresAt ? "expired" : "ready"));
  // the page, not the button, owns the payment in flight: a remounted button can't start a second one (R3 D3)
  const inFlight = useRef<Promise<void> | null>(null);
  const signer = useRef<Promise<Signer> | null>(null);
  useEffect(() => {
    if (!sale) return;
    const warm = () => {
      signer.current ??= loadSigner();
    };
    const hasIdle = typeof window.requestIdleCallback === "function"; // Safari lacks it: fall back to a short timeout
    const id = hasIdle ? window.requestIdleCallback(warm) : window.setTimeout(warm, 300);
    return () => (hasIdle ? window.cancelIdleCallback(id) : window.clearTimeout(id));
  }, [sale]);

  function pay() {
    if (!inFlight.current) {
      setPaying(true);
      inFlight.current = submit().finally(() => {
        inFlight.current = null;
        setPaying(false);
      });
    }
    return inFlight.current;
  }

  /** POST applies a code, DELETE removes it; the reply is the new amount due. */
  async function changeCode(method: "POST" | "DELETE", body?: { code: string }) {
    setCodeError(null);
    setCodeBusy(true);
    try {
      const res = await fetch(`/api/v1/sessions/${sessionId}/voucher`, { method, headers: { "content-type": "application/json" }, body: body && JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setCodeError(typeof data.error === "string" ? data.error : CODE_FAILED);
      focusAfterCode.current = true;
      setDue(dueFrom(data));
    } catch {
      setCodeError(CODE_FAILED);
    } finally {
      setCodeBusy(false);
    }
  }

  /** The amount to approve, read from our server now (security 009 F1: the server charges what it claims, so a stale
   *  amount here would only fail). If it moved since the payer saw the button, show it and stop. */
  async function currentTerms(terms: NonNullable<typeof sale>, shown: Due) {
    if (!code) return terms;
    const res = await fetch(`/api/v1/sessions/${sessionId}/voucher`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data.amountUnits !== "string") throw new Error(typeof data.error === "string" ? data.error : FAILED);
    const now = dueFrom(data);
    if (now.amountText !== shown.amountText) {
      setDue(now);
      throw new Error(`The total is now ${now.amountText} USDT. Check it, then hold to pay again.`);
    }
    return { ...terms, amount: data.amountUnits as string };
  }

  async function submit() {
    setError(null);
    try {
      if (!sale) throw new Error("Payments aren't live yet.");
      const { signSale } = await (signer.current ??= loadSigner());
      const approval = await signSale(await currentTerms(sale, due), expiresAt);
      let res: Response;
      try {
        res = await fetch(`/api/v1/sessions/${sessionId}/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(approval) });
      } catch {
        // the request may have reached our server before the connection dropped (plan review, batch 004)
        setPhase("confirming");
        throw new Shown();
      }
      const result = outcome(res.status, (await res.json().catch(() => ({}))) as PayAnswer);
      if (result.kind === "paid") return setReceipt({ receiptId: result.receiptId ?? sessionId, txHash: result.txHash });
      if (result.kind === "error") throw new Error(result.message);
      setPhase(result.kind === "closed" ? "expired" : "confirming");
      throw new Shown();
    } catch (e) {
      if (!(e instanceof Shown)) setError(e instanceof Error ? e.message : FAILED);
      throw e; // returns the hold button to idle
    }
  }

  const paidId = receipt?.receiptId ?? (paid ? sessionId : null);
  // the countdown ends the open sheet, never a payment in flight (it may land: security R1 S1)
  const left = now === null ? null : expiresAt - LAST_PAYABLE_MS - now;
  const shown: Phase = phase === "ready" && !paying && left !== null && left <= 0 ? "expired" : phase;
  const back = returnUrl && (
    <a href={returnUrl} className="inline-flex min-h-11 items-center justify-self-start text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover">
      Back to {merchantName}
    </a>
  );
  return (
    <section className="relative w-full max-w-[420px] rounded-[28px] bg-surface p-8 text-ink shadow-float" aria-live="polite">
      {paidId ? (
        <div className="grid gap-4">
          <h1 className="sr-only">Paid to {merchantName}</h1>
          <span className="justify-self-start rounded-pill border border-current px-3 py-0.5 text-xs font-medium tracking-wide text-positive">Paid</span>
          <p className="flex flex-wrap items-baseline gap-2">
            <span className="amount-xl">{due.amountText}</span>
            <span className="label text-ink-muted">USDT</span>
            <span className="text-ink-muted">to {merchantName}</span>
          </p>
          <dl className="grid gap-2 border-y border-hairline py-4 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Receipt</dt>
              <dd>
                <Link className="data text-accent underline underline-offset-4" href={`/r/${paidId}`}>
                  View receipt
                </Link>
              </dd>
            </div>
            {reference && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Order</dt>
                <dd>{reference}</dd>
              </div>
            )}
            {receipt?.txHash && (
              <div className="flex justify-between gap-4">
                <dt className="text-ink-muted">Record</dt>
                <dd>
                  <a className="text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${receipt.txHash}`} target="_blank" rel="noreferrer">
                    View on explorer ↗
                  </a>
                </dd>
              </div>
            )}
          </dl>
          <p className="text-sm text-ink-muted">
            You paid no network fee.
            <span className="block">Keep the receipt link; it shows any refund too.</span>
          </p>
          {back}
        </div>
      ) : (
        <div className="grid gap-6">
          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="label text-ink-muted">{reference ? `Order ${reference}` : "Checkout"}</span>
              {/* the sheet's state in words; "Confirming" names itself in its panel below */}
              {shown === "expired" ? (
                <span className={`${pill} text-warning`}>Expired</span>
              ) : paying ? (
                <span className={`${pill} text-accent`}>Paying</span>
              ) : shown === "ready" && left !== null && sale ? (
                <span role="timer" aria-live="off" className={`${pill} text-ink-muted tabular-nums`}>
                  {mmss(left)} left to pay
                </span>
              ) : null}
            </div>
            <h1 className="title">{merchantName}</h1>
          </div>
          {items.length > 0 && (
            <ul className="grid gap-2 border-y border-hairline py-4">
              {items.map((item, i) => (
                <li key={`${i}-${item.name}`} className="flex justify-between gap-4">
                  <span>
                    {item.qty} × {item.name}
                  </span>
                  <span className="tabular-nums">{item.price}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid gap-1">
            <p className="flex items-baseline justify-between">
              <span className="label text-ink-muted">Total</span>
              <span>
                <span className="amount-xl">{code ? code.totalText : due.amountText}</span>
                <span className="label ml-1.5 text-ink-muted">USDT</span>
              </span>
            </p>
            {due.discountText && (
              <p className="text-right text-sm tabular-nums">
                <span className="whitespace-nowrap text-positive">Discount −{due.discountText} USDT</span>
                {" · "}
                <span className="whitespace-nowrap font-medium">You pay {due.amountText} USDT</span>
              </p>
            )}
            {fxLine && (
              <p className="text-right text-xs text-ink-muted tabular-nums">
                {/* wraps between its parts, never inside one */}
                {fxLine.split(" · ").map((part, i) => (
                  <Fragment key={part}>
                    {i > 0 && " · "}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ))}
              </p>
            )}
          </div>
          {shown === "confirming" ? (
            <div className="grid gap-2">
              <Confirming />
              {back}
            </div>
          ) : shown === "expired" ? (
            // expiry isn't an error: the warning token, not red (UX review 004 R2 L2)
            <div className="grid gap-2">
              <p role="status" className="text-sm text-warning">
                This checkout has expired. Ask {merchantName} for a new one.
              </p>
              {back}
            </div>
          ) : sale ? (
            <div className="grid gap-3">
              {code && (
                // inert while paying: the server refuses a code change then anyway (F5)
                <details open={codeOpenAtStart} inert={paying} className={`group ${paying ? "opacity-45" : ""}`}>
                  <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-accent [&::-webkit-details-marker]:hidden">
                    Have a discount code?
                    <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
                  </summary>
                  {hasDiscount ? (
                    <p className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-positive">Discount applied</span>
                      <button ref={removeButton} type="button" aria-disabled={codeBusy} onClick={() => !codeBusy && changeCode("DELETE")} className="min-h-11 px-2 text-ink-muted underline underline-offset-4 hover:text-ink">
                        Remove
                      </button>
                    </p>
                  ) : (
                    <form
                      className="flex gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const typed = String(new FormData(event.currentTarget).get("code") ?? "");
                        if (!codeBusy) void changeCode("POST", { code: typed });
                      }}
                    >
                      <label htmlFor="discount-code" className="sr-only">
                        Discount code
                      </label>
                      <input
                        ref={codeInput}
                        id="discount-code"
                        name="code"
                        required
                        maxLength={32}
                        autoComplete="off"
                        autoCapitalize="characters"
                        spellCheck={false}
                        placeholder="Code"
                        aria-invalid={codeError ? true : undefined}
                        aria-describedby={codeError ? "code-error" : undefined}
                        className="h-11 min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 font-mono uppercase text-ink placeholder:font-sans placeholder:normal-case"
                      />
                      <button type="submit" aria-disabled={codeBusy} className="h-11 shrink-0 rounded-pill border border-current px-5 text-sm font-medium text-accent aria-disabled:opacity-45">
                        {codeBusy ? "Checking" : "Apply"}
                      </button>
                    </form>
                  )}
                  {codeError && (
                    <p id="code-error" role="alert" className="mt-2 text-sm text-critical">
                      {codeError}
                    </p>
                  )}
                </details>
              )}
              <HoldButton label={`Hold to pay ${due.amountText} USDT`} busyLabel="Paying" doneLabel="Paid" onConfirm={pay} aria-describedby="pay-hint" className="w-full" />
              <p id="pay-hint" className="text-center text-sm text-ink-muted">
                Pay exactly {due.amountText} USDT, no more and no less. No fees for you.
                <span className="block">Press and hold the button, or press Enter, to pay.</span>
              </p>
            </div>
          ) : (
            <p role="status" className="text-sm text-ink-muted">
              Payments aren&apos;t live yet. Nothing can be charged from this page.
            </p>
          )}
          {error && (
            // the demo message explains a limit, it isn't a failure: the warning tone, not red (UX review 005 N3)
            <p role="alert" className={`text-sm ${error === NOT_FUNDED ? "text-warning" : "text-critical"}`}>
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
