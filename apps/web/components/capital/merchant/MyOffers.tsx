"use client";

// M3 My live offers (FR-ARK-1, FR-ARK-2): this merchant's open and funded offers, from the chain joined with the offer
// book. An offer the book doesn't have yet gets Publish again (CAPITAL-TAB G4); Cancel while nobody has funded it.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { card } from "@/components/gateway/Frame";
import { CancelOffer, short } from "./Listing";
import { offerLabel, publishOffer, soldUnits, type MerchantOffer } from "./terms";

const ist = (iso: string) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", hour12: false, timeZone: "Asia/Kolkata" });
const head = "label sm:table-cell sm:px-4 sm:py-3";
const cell = "sm:table-cell sm:px-4 sm:py-3 sm:align-middle";

export function MyOffers({ merchant, offers }: { merchant: Address; offers: MerchantOffer[] }) {
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

function Row({ merchant, offer: o }: { merchant: Address; offer: MerchantOffer }) {
  const advance = o.kind === "advance";
  const unfunded = o.status === "open" && soldUnits(o) === 0n;
  return (
    <li className="grid gap-2 py-4 text-sm sm:table-row sm:border-t sm:border-hairline">
      <span className={cell}>
        <span className="block font-medium">{advance ? "Cash advance" : "Invoice"}</span>
        <span className="data text-ink-muted">Offer {o.id}</span>
      </span>
      <span className={`${cell} tabular-nums`}>
        {advance ? `${o.price} USDT now, repay ${o.face} at ${o.holdback_pct}% of sales` : `${o.price} USDT now for ${o.face} at maturity`}
        <span className="block text-xs text-ink-muted">Open to investors until {ist(o.offer_deadline)} IST</span>
      </span>
      <span className={cell}>
        <span className={`inline-flex rounded-pill border border-current px-3 py-0.5 text-xs font-medium ${o.status === "funded" ? "text-positive" : "text-accent"}`}>{offerLabel(o)}</span>
      </span>
      <span className={cell}>{o.arkiv.entity_key ? <InBook entityKey={o.arkiv.entity_key} /> : o.status === "open" ? <PublishAgain claimId={o.id} /> : <span className="text-ink-muted">Not in the offer book</span>}</span>
      <span className={cell}>{unfunded && <CancelOffer merchant={merchant} claimId={o.id} />}</span>
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
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function publish() {
    if (working) return;
    setError(null);
    setWorking(true);
    try {
      await publishOffer(claimId);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again in a minute.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <span className="grid justify-items-start gap-1">
      <span className="text-warning">Not in the offer book yet</span>
      <Button variant="quiet" className="text-sm" onClick={publish} aria-disabled={working}>
        {working ? "Publishing…" : "Publish again"}
      </Button>
      {error && (
        <span role="alert" className="max-w-64 text-critical">
          {error}
        </span>
      )}
    </span>
  );
}
