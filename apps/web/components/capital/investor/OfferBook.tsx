"use client";

// I1, the offer book (FR-ARK-2, FR-ARK-3, AT-9): GET /api/v1/capital/offers, the chain's live offers joined with their
// Arkiv entities (expired and cancelled ones are already left out). Buy opens the fund panel (I2) only for an open offer
// whose Arkiv terms match the chain; once a wallet connects, its eligibility, USDT and each offer's holders are read in
// the browser (counted on the meter) and can turn Buy off with the reason.
import { useEffect, useState, type ReactNode } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { card } from "@/components/gateway/Frame";
import { aprPercent, buyBlocker, investorsLabel, readHolders, readInvestor, usdt2, type BookOffer } from "@/lib/capital-wallet";
import { formatUsdt, parseUsdt } from "@/lib/usdt";
import { FundPanel } from "./FundPanel";
import { KIND_LABEL, istDate, istDateTime, kindBadge, short } from "./format";
import type { WalletState } from "./useInvestor";

type Book = { phase: "loading" } | { phase: "error" } | { phase: "ready"; offers: BookOffer[] };
type Me = { account: string; reads: "error" } | { account: string; reads: "ready"; eligible: boolean; balance: bigint; holders: Record<string, readonly Address[]> };

export interface ScreenProps {
  state: WalletState;
  connect: () => void;
}

export function OfferBook({ state, connect }: ScreenProps) {
  const [book, setBook] = useState<Book>({ phase: "loading" });
  const [me, setMe] = useState<Me | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const wallet = state.phase === "ready" ? state.wallet : null;

  useEffect(() => {
    let live = true;
    fetch("/api/v1/capital/offers")
      .then(async (res) => {
        const data = (await res.json()) as { offers?: BookOffer[] };
        if (!res.ok || !Array.isArray(data.offers)) throw new Error("offer book unreadable");
        if (live) setBook({ phase: "ready", offers: data.offers });
      })
      .catch(() => live && setBook((b) => (b.phase === "ready" ? b : { phase: "error" }))); // keep the last good book
    return () => {
      live = false;
    };
  }, [reload]);

  // holders only for offers Buy could open: chain-open and matching Arkiv
  const openIds = book.phase === "ready" ? book.offers.filter((o) => buyBlocker(o) === null).map((o) => o.id).join(",") : "";
  useEffect(() => {
    if (!wallet) return;
    let live = true;
    const ids = openIds ? openIds.split(",") : [];
    Promise.all([readInvestor(wallet), Promise.all(ids.map((id) => readHolders(wallet, BigInt(id))))]).then(
      ([investor, holders]) => live && setMe({ account: wallet.account, reads: "ready", ...investor, holders: Object.fromEntries(ids.map((id, i) => [id, holders[i]])) }),
      () => live && setMe({ account: wallet.account, reads: "error" }),
    );
    return () => {
      live = false;
    };
  }, [wallet, openIds, reload]);

  if (book.phase === "loading") return <p className="text-ink-muted">Loading the offer book…</p>;
  if (book.phase === "error") {
    return (
      <div role="alert" className={`${card} text-sm`}>
        <p>The offer book can&apos;t be read right now.</p>
        <Button variant="quiet" className="justify-self-start" onClick={() => setReload((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  if (book.offers.length === 0) {
    return (
      <p role="status" className={`${card} text-ink-muted`}>
        No open offers right now. When a shop lists a cash advance or an invoice, it shows here.
      </p>
    );
  }
  const mine = wallet && me?.account === wallet.account ? me : null;
  return (
    <section aria-labelledby="offers" className="grid gap-4">
      <h2 id="offers" className="eyebrow border-t border-hairline pt-3 text-ink-muted">
        {book.offers.length} {book.offers.length === 1 ? "offer" : "offers"} · checked against the chain
      </h2>
      {mine?.reads === "ready" && !mine.eligible && (
        <p role="status" className={`${card} text-sm text-warning`}>
          Your wallet is waiting for approval, so you can look but not buy yet. KYC is simulated on this demo: ask the team to approve {short(mine.account)}.
        </p>
      )}
      <ul className="grid gap-4">
        {book.offers.map((o) => (
          <li key={o.id} className={card}>
            <OfferRow
              offer={o}
              state={state}
              connect={connect}
              me={mine}
              open={selected === o.id}
              toggle={() => setSelected(selected === o.id ? null : o.id)}
              retry={() => setReload((n) => n + 1)}
            />
            {selected === o.id && wallet && mine?.reads === "ready" && (
              <FundPanel
                offer={o}
                wallet={wallet}
                balance={mine.balance}
                holders={mine.holders[o.id] ?? []}
                blocker={buyBlocker(o, { account: wallet.account, eligible: mine.eligible, holders: mine.holders[o.id] })}
                onFunded={() => setReload((n) => n + 1)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RowProps extends ScreenProps {
  offer: BookOffer;
  me: Me | null;
  open: boolean;
  toggle: () => void;
  retry: () => void;
}

function OfferRow({ offer: o, state, connect, me, open, toggle, retry }: RowProps) {
  const advance = o.kind === "advance";
  const maturity = Date.parse(o.maturity);
  const apr = advance ? null : aprPercent(parseUsdt(o.price), parseUsdt(o.face), Math.floor(maturity / 1000));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`${kindBadge} ${advance ? "text-accent" : "text-ink"}`}>{KIND_LABEL[o.kind]}</span>
        <span className="data text-ink-muted">#{o.id}</span>
        <span className="font-medium">{o.merchant_name}</span>
        <span className="text-xs text-ink-muted">{investorsLabel(o.kind)}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <Field label="You get back">
          {formatUsdt(parseUsdt(o.face))} USDT
          <Sub>{advance ? `from ${o.holdback_pct}% of each sale` : `when it's paid, due ${istDate(maturity)}`}</Sub>
        </Field>
        <Field label="Price for all of it">
          {usdt2(parseUsdt(o.price))} USDT
          {apr && <Sub>{`≈${apr.pct}% a year over ${apr.days} days`}</Sub>}
        </Field>
        <Field label="Left to buy">{formatUsdt(BigInt(o.units_left))} USDT</Field>
        <Field label="Open until">{istDateTime(Date.parse(o.offer_deadline))}</Field>
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-hairline pt-3">
        <span className="flex items-center gap-1 text-xs text-ink-muted">
          {o.arkiv.entity_key ? (
            <>
              Arkiv entity <span className="data">{short(o.arkiv.entity_key)}</span>
              <CopyButton text={o.arkiv.entity_key} name={`the Arkiv entity key of offer ${o.id}`} />
            </>
          ) : (
            "Not on Arkiv"
          )}
        </span>
        <BuyAction offer={o} state={state} connect={connect} me={me} open={open} toggle={toggle} retry={retry} />
      </div>
    </>
  );
}

function BuyAction({ offer, state, connect, me, open, toggle, retry }: RowProps) {
  const reason = buyBlocker(offer); // chain status and the Arkiv match, before any wallet
  if (reason) return <Reason>{reason}</Reason>;
  if (state.phase === "checking" || state.phase === "connecting") return <span className="text-sm text-ink-muted">Checking…</span>;
  if (state.phase === "disconnected" || state.phase === "wrong-network") {
    return (
      <Button className="h-11 px-5 text-sm" onClick={connect}>
        {state.phase === "disconnected" ? "Connect to buy" : "Switch network to buy"}
      </Button>
    );
  }
  if (!me) return <span className="text-sm text-ink-muted">Checking…</span>;
  if (me.reads === "error") {
    return (
      <span className="flex flex-wrap items-center gap-x-2 text-sm text-warning">
        Can&apos;t check this offer right now.
        <Button variant="quiet" className="text-sm" onClick={retry}>
          Try again
        </Button>
      </span>
    );
  }
  if (!me.eligible) return <Reason>Waiting for approval</Reason>;
  const walletReason = buyBlocker(offer, { account: state.wallet.account, eligible: me.eligible, holders: me.holders[offer.id] });
  if (walletReason && !open) return <Reason>{walletReason}</Reason>;
  return (
    <Button className="h-11 px-5 text-sm" variant={open ? "quiet" : "primary"} aria-expanded={open} onClick={toggle}>
      {open ? "Close" : "Buy"}
    </Button>
  );
}

const Reason = ({ children }: { children: string }) => <span className="max-w-md text-sm text-ink-muted sm:text-right">{children}</span>;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="eyebrow text-ink-muted">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </div>
  );
}

const Sub = ({ children }: { children: string }) => <span className="block text-xs text-ink-muted">{children}</span>;
