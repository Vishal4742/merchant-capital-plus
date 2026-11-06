// FR-INV-8 (batch 047): an invoice's acknowledgement, for investors (the offer book) and the merchant. Only the customer
// wallet the invoice names on chain earns the checked label (security 047 H1); the shop chooses that wallet, so it says
// "named customer wallet", never "debtor" (re-review). Any other ack is an unchecked wallet's. `debtor` is the short
// address our server sends, never the signature; the time is when our server accepted it.
import { istDateTime } from "@/components/capital/investor/format";
import type { DebtorAckView } from "@/lib/server/invoice-acks";

// = MAX_UNBOUND_ACKS in lib/server/invoice-acks.ts (server-only): an invoice keeps at most this many unchecked acks
export const ACK_CAP = 5;
/** "2", "3" … "5+": the route stops at the cap, and a race may pass it by one. */
export const ackCount = (n: number) => (n >= ACK_CAP ? `${ACK_CAP}+` : String(n));

export function DebtorAck({ ack }: { ack: DebtorAckView | null }) {
  if (!ack) return <span className="block text-xs text-ink-muted">Not acknowledged yet</span>;
  const time = istDateTime(Date.parse(ack.signed_at));
  const more = ack.count > 1 ? ` · ${ackCount(ack.count)} acknowledgements` : "";
  if (ack.verified) {
    return (
      <span className="block text-xs text-positive">
        Named customer wallet acknowledged ✓ <span className="data">{ack.debtor}</span> · {time}
        {more}
      </span>
    );
  }
  return (
    <span className="block text-xs text-ink-muted">
      Acknowledged by an unchecked wallet · <span className="data">{ack.debtor}</span> · {time}
      {more}
    </span>
  );
}
