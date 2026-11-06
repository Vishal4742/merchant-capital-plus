// FR-INV-8 (batch 047): whether an invoice's debtor acknowledged it, for investors (the offer book) and the merchant.
// `debtor` is the short address our server sends, never the signature; the time is when our server accepted it.
import { istDateTime } from "@/components/capital/investor/format";
import type { DebtorAckView } from "@/lib/server/invoice-acks";

export function DebtorAck({ ack }: { ack: DebtorAckView | null }) {
  if (!ack) return <span className="block text-xs text-ink-muted">Not acknowledged yet</span>;
  return (
    <span className="block text-xs text-positive">
      Debtor acknowledged ✓ <span className="data">{ack.debtor}</span> · {istDateTime(Date.parse(ack.signed_at))}
    </span>
  );
}
