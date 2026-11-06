"use client";

// I2, fund an offer (FR-ADV-3, FR-INV-3, CAPITAL-TAB §2.1, §4 I2). The investor types only how much it gets back; the
// cost is the contract's quote (GET /api/v1/capital/quote) and is shown before anything is signed. Holding the button
// signs one EIP-3009 authorization for exactly that cost, and POST /api/v1/capital/fund relays it: no gas (CON-4).
// Holder caps (batch 026): the investor taking a claim's last free slot buys everything left, so it is pre-filled.
import { useEffect, useId, useState } from "react";
import type { Address } from "viem";
import { HoldButton } from "@/components/HoldButton";
import { field } from "@/components/gateway/Frame";
import {
  UNKNOWN_FUNDING,
  amountBlocker,
  investorError,
  minUnits,
  postFunding,
  recordFunding,
  signFunding,
  slotRule,
  type BookOffer,
  type FundOutcome,
  type InvestorWallet,
} from "@/lib/capital-wallet";
import { EXPLORER, formatUsdt, parseUsdt, plainUsdt } from "@/lib/usdt";
import { istDate, short } from "./format";

const QUOTE_DELAY_MS = 300; // price once typing pauses

export interface FundPanelProps {
  offer: BookOffer;
  wallet: InvestorWallet;
  balance: bigint;
  holders: readonly Address[];
  /** Why this wallet can't buy this offer (buyBlocker), or null. */
  blocker: string | null;
  onFunded: () => void;
}

type Quote = { units: string; cost: bigint | null }; // cost null: the quote couldn't be read

function parseUnits(text: string): bigint | null {
  try {
    return parseUsdt(text);
  } catch {
    return null;
  }
}

export function FundPanel({ offer, wallet, balance, holders, blocker, onFunded }: FundPanelProps) {
  const left = BigInt(offer.units_left);
  const face = parseUsdt(offer.face);
  const price = parseUsdt(offer.price);
  const slot = slotRule(offer.kind, holders, wallet.account, left);
  const [text, setText] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [outcome, setOutcome] = useState<FundOutcome | null>(null);
  const [bought, setBought] = useState(0n); // the units of a confirmed funding, for the done view
  const describe = useId();
  const advance = offer.kind === "advance";

  const units = slot.kind === "last" ? slot.units : parseUnits(text);
  const unitsKey = units === null ? "" : units.toString();
  useEffect(() => {
    if (!unitsKey || unitsKey === "0") return;
    let live = true;
    const timer = setTimeout(() => {
      fetch(`/api/v1/capital/quote?claim=${encodeURIComponent(offer.id)}&units=${unitsKey}`)
        .then(async (res) => {
          const data = (await res.json()) as { cost?: unknown };
          if (!res.ok || typeof data.cost !== "string") throw new Error("no quote");
          if (live) setQuote({ units: unitsKey, cost: parseUsdt(data.cost) });
        })
        .catch(() => live && setQuote({ units: unitsKey, cost: null }));
    }, QUOTE_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [offer.id, unitsKey]);

  if (outcome?.kind === "done") {
    return (
      <div role="status" className="grid gap-2 rounded-sm border border-hairline bg-accent-soft p-4 text-sm">
        <p className="font-medium">Funded.</p>
        <p>
          You hold {formatUsdt(bought)} USDT more of claim #{offer.id}. The shop already has the USDT, and you&apos;re paid back{" "}
          {advance ? "from its sales" : "when the invoice is paid"}.
        </p>
        <div className="flex flex-wrap items-center gap-x-6">
          <a className="data inline-flex min-h-11 items-center text-accent underline underline-offset-4" href={`${EXPLORER}/tx/${outcome.txHash}`} target="_blank" rel="noreferrer">
            {short(outcome.txHash)} ↗
          </a>
          <a href="/capital/holdings" className="inline-flex min-h-11 items-center text-accent underline underline-offset-4">
            See your claims
          </a>
        </div>
      </div>
    );
  }
  if (outcome?.kind === "unknown") {
    return (
      <div role="status" className="grid gap-3 rounded-md border border-hairline p-4">
        <span className="justify-self-start rounded-pill border border-current px-3 py-0.5 text-xs font-medium tracking-wide text-warning">Confirming</span>
        <p className="text-sm">{UNKNOWN_FUNDING}</p>
        <a href="/capital/holdings" className="inline-flex min-h-11 items-center justify-self-start text-accent underline underline-offset-4">
          Your claims
        </a>
      </div>
    );
  }

  const pricing = units !== null && units > 0n && quote?.units !== unitsKey;
  const cost = quote?.units === unitsKey ? quote.cost : null;
  const quoteFailed = quote?.units === unitsKey && quote.cost === null;
  const typedBadly = slot.kind !== "last" && text.trim() !== "" && units === null;
  const stop = blocker ?? (typedBadly ? "Enter an amount like 11.00, with at most 6 decimals." : text.trim() === "" && slot.kind !== "last" ? null : amountBlocker(units ?? 0n, left, cost, balance));
  const smallest = minUnits(price, face);

  async function confirm() {
    if (units === null || cost === null) return;
    setOutcome(null);
    let result: FundOutcome;
    try {
      result = await postFunding(await signFunding(wallet, { claimId: BigInt(offer.id), units, cost }));
    } catch (error) {
      result = { kind: "error", message: investorError(error) };
    }
    if (result.kind === "done") setBought(units);
    setOutcome(result);
    if (result.kind === "done") {
      recordFunding(wallet.account, offer.id, units);
      onFunded();
    }
    if (result.kind === "error") throw new Error(result.message); // the button goes back to idle
  }

  return (
    <div className="grid gap-4 rounded-sm border border-hairline bg-surface-sunk p-4 md:p-5">
      <p className="text-sm">
        {advance
          ? `The shop gets ${formatUsdt(price)} USDT now and repays ${formatUsdt(face)} USDT from ${offer.holdback_pct}% of each sale. You buy part or all of that repayment.`
          : `The shop's customer pays ${formatUsdt(face)} USDT by ${istDate(Date.parse(offer.maturity))}. You buy part or all of it for less today.`}
      </p>
      <label className="grid max-w-sm gap-1 text-sm">
        <span className="text-ink-muted">You get back (USDT)</span>
        <input
          inputMode="decimal"
          autoComplete="off"
          placeholder={plainUsdt(left)}
          readOnly={slot.kind === "last"}
          value={slot.kind === "last" ? plainUsdt(slot.units) : text}
          onChange={(e) => {
            setText(e.target.value);
            if (outcome?.kind === "error") setOutcome(null); // a stale error goes as soon as anything changes
          }}
          className={`${field} tabular-nums read-only:bg-surface-sunk`}
        />
      </label>
      <p className="text-xs text-ink-muted">
        {slot.kind === "last"
          ? advance
            ? `A cash advance takes one investor, so you buy all of it: ${formatUsdt(slot.units)} USDT.`
            : `An invoice takes at most 2 investors and you'd be the last, so you buy everything left: ${formatUsdt(slot.units)} USDT.`
          : `Up to ${formatUsdt(left)} USDT. The smallest buy is ${formatUsdt(smallest)} USDT, which costs 1.00 USDT.`}
      </p>
      <p role="status" className="text-sm">
        {pricing
          ? "Checking the price…"
          : quoteFailed
            ? "We couldn't get the price right now. Try again in a moment."
            : cost !== null && units !== null
              ? `Total cost: ${formatUsdt(cost)} USDT. You get back ${formatUsdt(units)} USDT ${advance ? "from the shop's sales" : `when the invoice is paid, due ${istDate(Date.parse(offer.maturity))}`}.`
              : ""}
      </p>
      {stop && (
        <p role="status" className="text-sm text-warning">
          {stop}
        </p>
      )}
      {outcome?.kind === "error" && (
        <p role="alert" className="text-sm text-critical">
          {outcome.message}
        </p>
      )}
      {!stop && cost !== null && units !== null && (
        <div className="grid justify-items-start gap-2">
          <HoldButton label={`Hold to pay ${formatUsdt(cost)} USDT`} busyLabel="Funding…" doneLabel="Funded" onConfirm={confirm} aria-describedby={describe} />
          <p id={describe} className="text-xs text-ink-muted">
            Sign once to pay {formatUsdt(cost)} USDT from {short(wallet.account)}. No gas: our relayer sends it.
          </p>
        </div>
      )}
    </div>
  );
}
