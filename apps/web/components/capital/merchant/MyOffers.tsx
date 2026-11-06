"use client";

// M3 My live offers (FR-ARK-1, FR-ARK-2): this merchant's open and funded offers, from the chain joined with the offer
// book. An offer the book doesn't have yet gets Publish again (CAPITAL-TAB G4); Cancel while nobody has funded it.
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { DebtorAck } from "@/components/DebtorAck";
import { card } from "@/components/gateway/Frame";
import { parseUsdt } from "@/lib/usdt";
import { CancelOffer, short } from "./Listing";
import { bookRead, publishBlocked, settlePublish, snapshot, startPublish, subscribe } from "./publishing";
import { offerLabel, publishOffer, soldUnits, usdtAmounts, type OfferRow } from "./terms";

const head = "label sm:table-cell sm:px-4 sm:py-3";
const cell = "sm:table-cell sm:px-4 sm:py-3 sm:align-middle";

export function MyOffers({ merchant, offers }: { merchant: Address; offers: OfferRow[] }) {
  // each server read gives a new array: the book has been read again, so a settled publish may be retried (UX 036 F5)
  useEffect(() => bookRead(), [offers]);
  const live = offers.filter((o) => o.status === "open" || o.status === "funded");
  return (
    <section aria-labelledby="my-offers" className={card}>
      <h2 id="my-offers" className="text-[17px] font-medium">
        My live offers
      </h2>
      {live.length === 0 ? (
        <p className="text-sm text-ink-muted">No live offers. List an advance or an invoice above and it shows here.</p>
      ) : (
        // a card per offer on a phone, a table row from sm up (merchant Invoices pattern)
        <ul className="grid divide-y divide-hairline border-y border-hairline sm:table sm:w-full sm:divide-y-0 sm:border-collapse sm:text-sm">
          <li className="hidden bg-surface-sunk text-ink-muted sm:table-row" aria-hidden="true">
            {["Offer", "Terms", "Status", "Offer book", ""].map((h) => (
              <span key={h || "actions"} className={`${head} text-left`}>
                {h}
              </span>
            ))}
          </li>
          {live.map((o) => (
            <Row key={o.id} merchant={merchant} offer={o} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ merchant, offer: o }: { merchant: Address; offer: OfferRow }) {
  const advance = o.kind === "advance";
  const open = o.status === "open";
  const [price, face] = usdtAmounts(parseUsdt(o.price), parseUsdt(o.face));
  return (
    <li className="grid gap-2 py-4 text-sm sm:table-row sm:border-t sm:border-hairline">
      <span className={cell}>
        <span className="block font-medium">{advance ? "Cash advance" : "Invoice"}</span>
        <span className="data text-ink-muted">Offer {o.id}</span>
      </span>
      <span className={`${cell} tabular-nums`}>
        {advance ? `${price} USDT now, repay ${face} USDT at ${o.holdback_pct}% of sales` : `${price} USDT now for ${face} USDT at maturity`}
        {open && <span className="block text-xs text-ink-muted">Open to investors until {o.deadlineText} IST</span>}
        {!advance && <DebtorAck ack={o.debtor_ack} />}
      </span>
      <span className={cell}>
        <span className={`inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium ${o.status === "funded" ? "text-positive" : "text-accent"}`}>{offerLabel(o)}</span>
      </span>
      <span className={cell}>{o.arkiv.entity_key ? <InBook entityKey={o.arkiv.entity_key} /> : open ? <PublishAgain claimId={o.id} /> : <span className="text-ink-muted">Not in the offer book</span>}</span>
      <span className={cell}>{open && soldUnits(o) === 0n && <CancelOffer merchant={merchant} claimId={o.id} />}</span>
    </li>
  );
}

const InBook = ({ entityKey }: { entityKey: string }) => (
  <span className="inline-flex flex-wrap items-center gap-x-1">
    <span className="data">{short(entityKey)}</span>
    <CopyButton text={entityKey} name="the offer book entry key" />
  </span>
);

function PublishAgain({ claimId }: { claimId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const blocked = publishBlocked(claimId); // in flight here or from the listing above, or not re-read since
  async function publish() {
    if (publishBlocked(claimId)) return;
    setError(null);
    startPublish(claimId);
    try {
      await publishOffer(claimId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The offer book didn't answer.");
    } finally {
      settlePublish(claimId);
    }
    router.refresh(); // Publish again comes back only once this read shows the book again
  }
  return (
    <span className="grid justify-items-start gap-1">
      <span className="text-warning">Not in the offer book yet</span>
      <Button variant="quiet" className="text-sm" onClick={publish} aria-disabled={blocked}>
        {blocked ? "Adding it to the offer book…" : "Publish again"}
      </Button>
      {error && (
        <span role="alert" className="max-w-64 text-critical">
          {error}
        </span>
      )}
    </span>
  );
}
