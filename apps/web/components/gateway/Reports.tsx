// Reports (FR-GW-9): the totals for a range of India days as tiles, gross per day as a line, the same days as a table,
// and the CSV of the payments behind them. Server-rendered: the range is a plain GET form, so the screen needs no
// script. Every figure is the API's own, formatted for display only (no client sums).
import { Button } from "@/components/Button";
import { GrossLine } from "@/components/dashboard/GrossChart";
import { Reveal } from "@/components/dashboard/Reveal";
import { card, field, textLink } from "@/components/gateway/Frame";
import { amountText } from "@/lib/gateway-forms";
import { MAX_REPORT_DAYS, csvHref, dayLabel, isZero, reportTiles, type Report, type ReportRange, type Tile } from "@/lib/gateway-money";

/** The from/to days as typed (shown back even when they don't make a range). */
export interface RangeInput {
  from: string;
  to: string;
}

/** The date range: two native date fields, sent as ?from&to to the same page. */
export function RangeForm({ action, value, error, csv }: { action: string; value: RangeInput; error?: string; csv?: ReportRange }) {
  return (
    <section aria-label="Date range" className="grid gap-2">
      <form method="get" action={action} className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <label className="grid w-40 gap-1 text-sm">
          <span className="text-ink-muted">From</span>
          <input type="date" name="from" defaultValue={value.from} required className={`${field} tabular-nums`} />
        </label>
        <label className="grid w-40 gap-1 text-sm">
          <span className="text-ink-muted">To</span>
          <input type="date" name="to" defaultValue={value.to} required className={`${field} tabular-nums`} />
        </label>
        <Button type="submit" className="h-11">
          Show
        </Button>
        {csv && (
          <a href={csvHref(csv)} download className={`${textLink} md:ml-auto`}>
            Download CSV
          </a>
        )}
      </form>
      <p className="text-xs text-ink-muted">Days in India time (IST), up to {MAX_REPORT_DAYS} at a time.</p>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </section>
  );
}

function Tiles({ label, tiles, className }: { label: string; tiles: Tile[]; className: string }) {
  return (
    <section aria-label={label} className={`grid gap-px overflow-hidden rounded-[20px] border border-hairline bg-hairline ${className}`}>
      {tiles.map((tile) => (
        <div key={tile.label} className="grid min-w-0 content-start gap-1.5 bg-surface p-4 md:p-[18px]">
          <h3 className="eyebrow text-ink-muted">{tile.label}</h3>
          <b className="text-[26px] leading-none font-medium tracking-[-0.03em] break-all tabular-nums md:text-[28px]">
            <Reveal text={tile.value} />
          </b>
          <span className="text-xs text-ink-muted">{tile.sub}</span>
        </div>
      ))}
    </section>
  );
}

/** A card without padding, for a table that runs to its edges. */
export const panel = "grid min-w-0 content-start gap-4 rounded-[20px] border border-hairline bg-surface pb-5";
const cell = "px-3 py-2.5 md:px-5";
const num = `${cell} text-right`;

function DayTable({ report }: { report: Report }) {
  const t = report.totals;
  return (
    <section aria-labelledby="by-day" className={panel}>
      <div className="grid gap-1 px-5 pt-5 md:px-6">
        <h2 id="by-day" className="text-[15px] font-medium">
          By day
        </h2>
        <p className="text-xs text-ink-muted md:hidden">Swipe the table sideways for fees, net and refunds.</p>
      </div>
      {/* a phone scrolls the table, not the page; the region is focusable so a keyboard can scroll it too */}
      <div role="region" aria-labelledby="by-day" tabIndex={0} className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm tabular-nums">
          <thead className="bg-surface-sunk text-ink-muted">
            <tr>
              {["Day", "Payments", "Gross", "Fees", "Net", "Refunds"].map((h, i) => (
                <th key={h} scope="col" className={`label ${cell} ${i === 0 ? "text-left" : "text-right"}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.days.map((d) => (
              <tr key={d.date} className={`border-t border-hairline ${d.count === 0 && isZero(d.refunds) ? "text-ink-muted" : ""}`}>
                <th scope="row" className={`${cell} text-left font-normal`}>
                  {dayLabel(d.date)}
                </th>
                <td className={num}>{d.count}</td>
                <td className={num}>{amountText(d.gross)}</td>
                <td className={num}>{amountText(d.fees)}</td>
                <td className={num}>{amountText(d.net)}</td>
                <td className={num}>{amountText(d.refunds)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="font-medium">
            <tr className="border-t border-ink">
              <th scope="row" className={`${cell} text-left`}>
                Total
              </th>
              <td className={num}>{t.count}</td>
              <td className={num}>{amountText(t.gross)}</td>
              <td className={num}>{amountText(t.fees)}</td>
              <td className={num}>{amountText(t.net)}</td>
              <td className={num}>{amountText(t.refunds)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="px-5 text-xs text-ink-muted md:px-6">All amounts in USDT. Net is what you and any investors got, before refunds.</p>
    </section>
  );
}

export function ReportView({ report }: { report: Report }) {
  const { money, people } = reportTiles(report);
  const first = report.days[0]?.date ?? report.from, last = report.days.at(-1)?.date ?? report.to;
  const span = first === last ? dayLabel(first) : `${dayLabel(first)} to ${dayLabel(last)}`;
  const empty = report.totals.count === 0 && isZero(report.totals.refunds);
  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[4fr_3fr]">
        <Tiles label="Money" tiles={money} className="grid-cols-2 md:grid-cols-4" />
        <Tiles label="Payers" tiles={people} className="grid-cols-3" />
      </div>
      {empty ? (
        <p className={`${card} text-sm text-ink-muted`}>No payments in these days. Pick a wider range, or open a test checkout from the dashboard home.</p>
      ) : (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          <section aria-labelledby="per-day" className={`${card} lift gap-3`}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="per-day" className="eyebrow text-ink-muted">
                Gross per day
              </h2>
              <span className="text-sm text-ink-muted">
                <b className="font-medium text-ink tabular-nums">{amountText(report.totals.gross)}</b> USDT · {span}
              </span>
            </div>
            <GrossLine
              id="report"
              values={report.days.map((d) => Number(d.gross))} // the line's geometry only; every figure shown is the API's text
              readouts={report.days.map((d) => `${dayLabel(d.date)}: ${amountText(d.gross)} USDT, ${d.count} ${d.count === 1 ? "payment" : "payments"}`)}
              label={`Gross per day, ${span}: ${amountText(report.totals.gross)} USDT in all. Every day's figures are in the table below.`}
              fromText={dayLabel(first)}
              toText={dayLabel(last)}
            />
          </section>
          <DayTable report={report} />
        </div>
      )}
    </>
  );
}
