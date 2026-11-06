// Settlements (FR-GW-10): the plain T+0 line and each payment's split (gross, the relay fee, the
// investors' share, what reached the wallet) with its transaction. Server-rendered; the figures are the API's own. The
// wallet's balance is shown once, in the Withdraw card above (FR-GW-15, batch 040).
import { nightGrain } from "@/components/gateway/Frame";
import { panel } from "@/components/gateway/Reports";
import { amountText } from "@/lib/gateway-forms";
import { formatWbt, WBT_HINT } from "@/lib/dashboard";
import { istText, type Settlements } from "@/lib/gateway-money";
import { EXPLORER } from "@/lib/usdt";

const FIGURES = [
  ["Gross", "gross"],
  ["Fee", "fee"],
  ["To investors", "to_investors"],
  ["Net to you", "net"],
] as const;
const cellLink = "inline-flex min-h-11 items-center text-accent underline underline-offset-4";
const tableCell = "md:table-cell md:px-6 md:py-3 md:align-middle";

/** `fees`: the network fee the relayer covered per transaction hash (FR-GW-10, claude-research 06:43); null = unread. */
export function SettlementsView({ data, fees = new Map() }: { data: Settlements; fees?: ReadonlyMap<string, bigint | null> }) {
  const rows = data.settlements;
  return (
    <>
      <section
        aria-labelledby="t0"
        className={`grid content-start gap-4 rounded-[20px] border border-hairline p-5 text-[#ededf3] md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-x-8 md:p-6 ${nightGrain}`}
      >
        <h2 id="t0" className="eyebrow text-[#a7abc2] md:col-span-2">
          Settlement
        </h2>
        <b className="text-[36px] leading-none font-medium tracking-[-0.03em] md:text-[44px]">T+0</b>
        <p className="text-sm text-[#c9cbe0]">Each payment settles to your wallet in the same transaction, the moment it&apos;s paid.</p>
      </section>

      <section aria-labelledby="settled" className={panel}>
        <h2 id="settled" className="px-5 pt-5 text-[15px] font-medium md:px-6">
          {rows.length} {rows.length === 1 ? "settlement" : "settlements"}
        </h2>
        {rows.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-ink-muted md:px-6">No payments settled in these days. Pick a wider range above.</p>
        ) : (
          // a card per payment on a phone, a table row from md up (as on Payments)
          <ul className="grid divide-y divide-hairline text-sm md:table md:w-full md:divide-y-0 md:border-collapse">
            <li className="hidden bg-surface-sunk text-ink-muted md:table-row" aria-hidden="true">
              {["Payment", ...FIGURES.map(([label]) => label), "Network fee", "Transaction"].map((h, i) => (
                <span key={h} className={`label ${tableCell} ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </span>
              ))}
            </li>
            {rows.map((s) => (
              <li key={s.payment_id} className="grid grid-cols-2 items-center gap-x-6 gap-y-1 px-5 py-4 md:table-row md:border-t md:border-hairline md:hover:bg-accent-soft">
                <span className={`col-span-2 ${tableCell}`}>
                  <span className="data">Payment {s.payment_id}</span>
                  <span className="data text-ink-muted"> · {istText(s.settled_at)}</span>
                </span>
                {FIGURES.map(([label, key]) => (
                  <span key={key} className={`flex justify-between gap-2 tabular-nums ${tableCell} md:text-right`}>
                    {/* the label stays for screen readers from md up, where the header row is visual only */}
                    <span className="text-ink-muted md:sr-only">{label}</span>
                    <span className={key === "net" ? "font-medium" : ""}>{amountText(s[key])}</span>
                  </span>
                ))}
                <span className={`flex justify-between gap-2 tabular-nums text-ink-muted ${tableCell} md:text-right`}>
                  <span className="md:sr-only">Network fee we covered</span>
                  <span>{(() => { const fee = s.tx_hash ? fees.get(s.tx_hash) : undefined; return fee === null || fee === undefined ? "—" : `${formatWbt(fee)} WBT`; })()}</span>
                </span>
                <span className={`col-span-2 ${tableCell} md:text-right`}>
                  {s.tx_hash ? (
                    <a href={`${EXPLORER}/tx/${s.tx_hash}`} target="_blank" rel="noreferrer" className={cellLink}>
                      View transaction ↗
                    </a>
                  ) : (
                    <span className="text-ink-muted">No transaction link yet</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="px-5 text-xs text-ink-muted md:px-6">Amounts in USDT. To investors is 0.00 unless an advance is open. {WBT_HINT}</p>
      </section>
    </>
  );
}
