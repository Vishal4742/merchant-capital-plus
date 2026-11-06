"use client";

// I3, the investor's claims (CAPITAL-TAB §4 I3, G6): read in the browser by address (no route, no sign-in), counted on
// the meter. Each unit is 0.000001 USDT still owed to its holder; payouts burn units, so "paid back" is what this browser
// funded minus what is still held. A revoked investor still sees its claims and is still repaid (FR-TOK-7); the
// transfer check under each claim says why a move would fail (I4).
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { card } from "@/components/gateway/Frame";
import { investorError, readHoldings, readInvestor, usdt2, type Holding } from "@/lib/capital-wallet";
import { KIND_LABEL, istDate, istDateTime, kindBadge } from "./format";
import type { ScreenProps } from "./OfferBook";
import { TransferCheck } from "./TransferCheck";

type Data = { account: string; phase: "error"; message: string } | { account: string; phase: "ready"; holdings: Holding[]; owed: bigint; eligible: boolean };

export function Holdings({ state, connect }: ScreenProps) {
  const [data, setData] = useState<Data | null>(null);
  const [reload, setReload] = useState(0);
  const wallet = state.phase === "ready" ? state.wallet : null;

  useEffect(() => {
    if (!wallet) return;
    let live = true;
    Promise.all([readHoldings(wallet), readInvestor(wallet)]).then(
      ([h, investor]) => live && setData({ account: wallet.account, phase: "ready", ...h, eligible: investor.eligible }),
      (error: unknown) => live && setData({ account: wallet.account, phase: "error", message: investorError(error) }),
    );
    return () => {
      live = false;
    };
  }, [wallet, reload]);

  if (state.phase === "checking" || state.phase === "connecting") return <p className="text-ink-muted">Looking for your wallet…</p>;
  if (state.phase === "disconnected" || state.phase === "wrong-network") {
    const wrong = state.phase === "wrong-network";
    return (
      <div className={`${card} text-sm`}>
        <p>{wrong ? "Your wallet is on another network. Switch it to Whitechain Testnet to see your claims." : "Connect your wallet to see the claims it holds and what you've been paid back."}</p>
        <Button className="h-11 justify-self-start px-5 text-sm" onClick={connect}>
          {wrong ? "Switch network" : "Connect wallet"}
        </Button>
      </div>
    );
  }
  const mine = data?.account === state.wallet.account ? data : null;
  if (!mine) return <p className="text-ink-muted">Reading your claims…</p>;
  if (mine.phase === "error") {
    return (
      <div role="alert" className={`${card} text-sm`}>
        <p>We couldn&apos;t read your claims right now. {mine.message}</p>
        <Button variant="quiet" className="justify-self-start" onClick={() => setReload((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  return (
    <section aria-labelledby="claims" className="grid gap-4">
      <h2 id="claims" className="eyebrow border-t border-hairline pt-3 text-ink-muted">
        Claims held by this wallet
      </h2>
      {!mine.eligible && (
        <p role="status" className={`${card} text-sm text-warning`}>
          This wallet isn&apos;t approved as an investor right now, so it can&apos;t buy or move claims. It is still paid back on every claim it holds.
        </p>
      )}
      {mine.owed > 0n && (
        <p role="status" className={`${card} text-sm`}>
          {usdt2(mine.owed)} USDT is waiting for you in the market: a payout couldn&apos;t reach your wallet, so it was kept for you.
        </p>
      )}
      {mine.holdings.length === 0 ? (
        <div className={`${card} text-sm`}>
          <p className="text-ink-muted">You don&apos;t hold any claims yet.</p>
          <a href="/capital" className="inline-flex min-h-11 items-center justify-self-start text-accent underline underline-offset-4">
            See the open offers
          </a>
        </div>
      ) : (
        <ul className="grid gap-4">
          {mine.holdings.map((h) => (
            <li key={h.id.toString()} className={card}>
              <ClaimCard holding={h} />
              {h.held > 0n && <TransferCheck from={state.wallet.account} claimId={h.id} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function status(h: Holding, now: number): { label: string; tone: string } {
  if (h.held === 0n && h.settled) return { label: "Repaid in full", tone: "text-positive" };
  if (h.held === 0n) return { label: "Moved out", tone: "text-ink-muted" };
  if (h.frozen) return { label: "Frozen", tone: "text-warning" };
  if (h.lockFrom !== 0 && now >= h.lockFrom) return { label: "Locked for repayment", tone: "text-warning" };
  return { label: h.kind === "advance" ? "Repaying" : "Awaiting payment", tone: "text-accent" };
}

function ClaimCard({ holding: h }: { holding: Holding }) {
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const s = status(h, now);
  const paidBack = h.funded !== null && h.funded > h.held ? h.funded - h.held : null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{KIND_LABEL[h.kind]}</span>
        <span className="data text-ink-muted">#{h.id.toString()}</span>
        <span className={`${kindBadge} ${s.tone}`}>{s.label}</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <Field label="Still owed to you" value={`${usdt2(h.held)} USDT`} />
        <Field label="Paid back to you" value={paidBack !== null ? `${usdt2(paidBack)} USDT` : h.funded !== null ? "0.00 USDT" : "—"} />
        <Field label="Owed on the claim" value={`${usdt2(h.outstanding)} USDT`} />
        <Field label={h.kind === "advance" ? "Expected by" : "Due"} value={istDate(h.maturity * 1000)} />
      </dl>
      {h.lockFrom !== 0 && now < h.lockFrom && <p className="text-xs text-ink-muted">Its units can&apos;t move from {istDateTime(h.lockFrom * 1000)}, just before it&apos;s due.</p>}
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="eyebrow text-ink-muted">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
