"use client";

// M1 Cash advance (FR-ADV-1, 2, 5, 6; AT-3, AT-5): the running advance when there is one, else the form with its total
// cost shown before the wallet opens. One advance at a time: CapitalMarket refuses a second (AdvanceActive).
import { useState, type FormEvent } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { card, field } from "@/components/gateway/Frame";
import { WBT_HINT } from "@/lib/dashboard";
import { formatUsdt } from "@/lib/usdt";
import { CancelOffer, DEADLINES, DEFAULT_DEADLINE, ListingStatus, busy, useListing } from "./Listing";
import { advanceCostLine, advanceState, advanceTerms, type MerchantAdvance, type OfferRow } from "./terms";
import { listAdvance } from "./wallet";


interface AdvancePanelProps {
  merchant: Address;
  advance: MerchantAdvance;
  offers: OfferRow[];
}

export function AdvancePanel({ merchant, advance, offers }: AdvancePanelProps) {
  const listing = useListing(merchant);
  const state = advanceState(advance, offers);
  return (
    <section aria-labelledby="advance" className={card}>
      <div className="grid gap-1">
        <h2 id="advance" className="text-[17px] font-medium">
          Cash advance
        </h2>
        <p className="text-sm text-ink-muted">Investors fund it now. You pay it back from a share of each sale, and it stops at the cap.</p>
      </div>
      {state.kind === "repaying" && <Repaying {...state} />}
      {(state.kind === "open" || state.kind === "expired") && (
        <div className="grid gap-3 rounded-sm border border-hairline p-4 text-sm">
          <p>
            <span className="font-medium">Offer {state.claimId}</span>{" "}
            {state.kind === "open" ? (
              <>is listed and waiting for investors{state.offer && <> until {offers.find((o) => o.id === state.claimId)?.deadlineText} IST</>}.</>
            ) : (
              <>wasn&apos;t funded before its deadline. Cancel it to list a new one.</>
            )}
          </p>
          {state.offer && (
            <p className="text-ink-muted">
              You get {state.offer.price} USDT and repay {state.offer.face} USDT from {state.offer.holdback_pct}% of each sale.
            </p>
          )}
          <CancelOffer merchant={merchant} claimId={state.claimId} />
        </div>
      )}
      {state.kind === "repaid" && (
        <p role="status" className="rounded-sm border border-hairline bg-accent-soft p-4 text-sm">
          Repaid. Sales now go 100% to you, minus the fee. <span className="text-ink-muted">(Offer {state.claimId})</span>
        </p>
      )}
      {(state.kind === "none" || state.kind === "repaid") && <AdvanceForm listing={listing} />}
      <ListingStatus state={listing.state} />
    </section>
  );
}

function Repaying({ claimId, cap, outstanding, repaid, holdbackPct }: { claimId: string; cap: bigint; outstanding: bigint; repaid: bigint | null; holdbackPct: number }) {
  const done = cap === 0n ? 0 : Number(((cap - outstanding) * 100n) / cap);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium text-accent">Repaying</span>
        <span className="data text-sm text-ink-muted">Offer {claimId}</span>
      </div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline sm:grid-cols-4">
        {[
          ["Still to repay", `${formatUsdt(outstanding)} USDT`],
          ["Cap", `${formatUsdt(cap)} USDT`],
          ["Repaid so far", repaid === null ? "—" : `${formatUsdt(repaid)} USDT`],
          ["Holdback", `${holdbackPct}% of each sale`],
        ].map(([label, value]) => (
          <div key={label} className="grid gap-1 bg-surface p-3">
            <dt className="eyebrow text-ink-muted">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-pill bg-surface-sunk">
        <div className="h-full rounded-pill bg-accent" style={{ width: `${done}%` }} />
      </div>
      <p className="text-sm text-ink-muted">
        Each sale sends {holdbackPct}% to your investors until {formatUsdt(cap)} USDT is repaid. Then sales go 100% to you again. You can list a new advance once this one is repaid.
      </p>
    </div>
  );
}

function AdvanceForm({ listing }: { listing: ReturnType<typeof useListing> }) {
  const [form, setForm] = useState({ principal: "", cap: "", holdback: "", termDays: "30", deadline: String(DEFAULT_DEADLINE) });
  // the cost line needs the amounts only, so it shows as soon as they read right (FR-ADV-6)
  const preview = advanceTerms({ ...form, deadline: 1 }, 0);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    listing.clear();
    setForm({ ...form, [key]: e.target.value });
  };

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const now = Math.floor(Date.now() / 1000);
    const terms = advanceTerms({ ...form, deadline: now + Number(form.deadline) }, now);
    if (!terms.ok) return listing.fail(terms.error);
    void listing.run((w) => listAdvance(w, terms.value));
  }

  const label = "grid gap-1 text-sm";
  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className={label}>
          <span className="text-ink-muted">You get (principal), USDT</span>
          <input value={form.principal} onChange={set("principal")} inputMode="decimal" autoComplete="off" placeholder="10.00" required className={field} />
        </label>
        <label className={label}>
          <span className="text-ink-muted">You repay at most (cap), USDT</span>
          <input value={form.cap} onChange={set("cap")} inputMode="decimal" autoComplete="off" placeholder="11.00" required className={field} />
        </label>
        <label className={label}>
          <span className="text-ink-muted">Holdback, % of each sale</span>
          <input value={form.holdback} onChange={set("holdback")} inputMode="decimal" autoComplete="off" placeholder="20" required className={field} />
        </label>
        <label className={label}>
          <span className="text-ink-muted">Term, days</span>
          <input value={form.termDays} onChange={set("termDays")} inputMode="numeric" autoComplete="off" placeholder="30" required className={field} />
        </label>
        <label className={label}>
          <span className="text-ink-muted">Investors can fund it for</span>
          <select value={form.deadline} onChange={set("deadline")} className={field}>
            {DEADLINES.map((d) => (
              <option key={d.seconds} value={d.seconds}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p aria-live="polite" className="text-[15px]">
        {preview.ok ? advanceCostLine(preview.value.principal, preview.value.cap, preview.value.holdbackBps) : <span className="text-ink-muted">Enter the amounts to see what the advance costs.</span>}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="submit" aria-disabled={busy(listing.state)}>
          {busy(listing.state) ? "Listing…" : "List the advance"}
        </Button>
        <p className="max-w-[60ch] text-xs text-ink-muted">Your wallet sends the listing and pays about 0.0007 WBT. Nothing moves until investors fund it. {WBT_HINT}</p>
      </div>
    </form>
  );
}
