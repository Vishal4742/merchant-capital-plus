// FR-INV-8 (batch 047): an invoice's acknowledgement, for investors (the offer book) and the merchant. Only the customer
// wallet the invoice names on chain earns the checked "Debtor acknowledged" (security 047 H1); any other ack is a pay-link
// holder's, said plainly with "identity not checked". `debtor` is the short address our server sends, never the
// signature; the time is when our server accepted it.
import { istDateTime } from "@/components/capital/investor/format";
import type { DebtorAckView } from "@/lib/server/invoice-acks";

export function DebtorAck({ ack }: { ack: DebtorAckView | null }) {
  if (!ack) return <span className="block text-xs text-ink-muted">Not acknowledged yet</span>;
  const time = istDateTime(Date.parse(ack.signed_at));
  const more = ack.count > 1 ? ` · ${ack.count} acknowledgements` : "";
  if (ack.verified) {
    return (
      <span className="block text-xs text-positive">
        Debtor acknowledged ✓ <span className="data">{ack.debtor}</span> · {time}
        {more}
      </span>
    );
  }
  return (
    <span className="block text-xs text-ink-muted">
      Acknowledged by a pay-link holder · <span className="data">{ack.debtor}</span> (identity not checked) · {time}
      {more}
    </span>
  );
}
