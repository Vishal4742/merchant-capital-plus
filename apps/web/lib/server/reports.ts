// Reports from MerchantPay's Paid and Refunded logs (SRS FR-GW-9, AT-15): Blockscout's log index, no tables.
// ponytail: the index fetch repeats lib/onchain.ts indexedLogs, which isn't exported and has neither Refunded nor the
// Paid split (fee, toInvestors, toMerchant, payer); export one shared fetcher from there if a third caller appears.
import { decodeEventLog, formatUnits, isHash, pad, parseAbi, toEventSelector, type Address, type Hex } from "viem";
import { payConfig } from "../config.ts";
import { EXPLORER, USDT_DECIMALS } from "../usdt.ts";
import { HttpError } from "./http.ts";

const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 92;
const INDEX_PAGE = 1_000; // Blockscout's getLogs returns at most 1,000 logs per call
const INDEX_MAX_PAGES = 10;
const INDEX_TIMEOUT_MS = 5_000;
const INDEX_DOWN = "The payment history isn't available right now. Try again in a minute.";

const events = parseAbi([
  "event Paid(uint256 indexed paymentId, address indexed merchant, address indexed payer, uint256 invoiceId, bytes32 orderRef, uint256 gross, uint256 fee, uint256 toInvestors, uint256 toMerchant)",
  "event Refunded(uint256 indexed paymentId, uint256 amount, uint256 totalRefunded)",
]);
type EventName = "Paid" | "Refunded";
type PaidArgs = { paymentId: bigint; merchant: Address; payer: Address; gross: bigint; fee: bigint; toInvestors: bigint; toMerchant: bigint };
type RefundedArgs = { paymentId: bigint; amount: bigint };
type IndexLog = { address?: string; blockNumber?: string; logIndex?: string; data?: Hex; topics?: [Hex, ...Hex[]]; transactionHash?: string; timeStamp?: string };

export interface ChainPayment {
  paymentId: bigint;
  payer: Address;
  gross: bigint;
  fee: bigint;
  toInvestors: bigint;
  toMerchant: bigint;
  refunded: bigint; // all refunds on this payment so far
  txHash: Hex | null;
  time: number; // block time, ms
}
export interface ChainRefund {
  paymentId: bigint;
  amount: bigint;
  time: number;
}
export interface History {
  payments: ChainPayment[]; // oldest first
  refunds: ChainRefund[];
}
/** Days `from`..`to` inclusive in time zone `tz` (IANA, default UTC); `start`..`end` = local midnights in ms, end exclusive. */
export interface Range {
  from: string;
  to: string;
  tz: string;
  start: number;
  end: number;
}

export const usdt = (units: bigint) => formatUnits(units, USDT_DECIMALS);
const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
const utcMidnight = (date: string) => Date.parse(`${date}T00:00:00Z`);
const addDays = (date: string, n: number) => new Date(utcMidnight(date) + n * DAY_MS).toISOString().slice(0, 10);

/** ms → that instant's calendar date in `tz` (en-CA formats as YYYY-MM-DD). */
const dayFormatter = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });

/** `tz`'s offset from UTC at `ms` (local wall clock − UTC), in ms. */
function offsetAt(ms: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - (ms - (ms % 1000));
}

/** The instant `date` begins in `tz`. Two passes, so a DST change between the guess and the answer still lands right. */
function localMidnight(date: string, tz: string): number {
  const wall = utcMidnight(date);
  return wall - offsetAt(wall - offsetAt(wall, tz), tz);
}

function dateParam(value: string | null, name: string): string | null {
  if (!value) return null;
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(utcMidnight(value)) && addDays(value, 0) === value;
  if (!ok) throw new HttpError(400, `${name} must be a date like 2026-11-06.`);
  return value;
}

function zoneParam(value: string | null): string {
  if (!value) return "UTC";
  try {
    if (value.length > 64) throw new Error("too long");
    new Intl.DateTimeFormat("en-US", { timeZone: value }); // throws RangeError on an unknown zone
    return value;
  } catch {
    throw new HttpError(400, "tz must be a time zone like Asia/Kolkata.");
  }
}

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD&tz=Asia/Kolkata` (inclusive; tz default UTC); the last 7 days by default, at most 92. */
export function rangeOf(request: Request, now = Date.now()): Range {
  const params = new URL(request.url).searchParams;
  const tz = zoneParam(params.get("tz"));
  const to = dateParam(params.get("to"), "to") ?? dayFormatter(tz).format(now);
  const from = dateParam(params.get("from"), "from") ?? addDays(to, -(DEFAULT_DAYS - 1));
  if (from > to) throw new HttpError(400, "from must be on or before to.");
  if ((utcMidnight(to) - utcMidnight(from)) / DAY_MS + 1 > MAX_DAYS) throw new HttpError(400, `A report covers at most ${MAX_DAYS} days.`);
  return { from, to, tz, start: localMidnight(from, tz), end: localMidnight(addDays(to, 1), tz) };
}

/** MerchantPay's address, or 503 until the contracts are configured on this server. */
export function merchantPayAddress(): Address {
  const config = payConfig();
  if (!config) throw new HttpError(503, "Payments aren't set up on this server yet.");
  return config.merchantPay;
}

async function indexPage(query: Record<string, string>): Promise<IndexLog[]> {
  const result = await fetch(`${EXPLORER}/api?${new URLSearchParams(query)}`, { signal: AbortSignal.timeout(INDEX_TIMEOUT_MS), cache: "no-store" })
    .then(async (res) => (res.ok ? ((await res.json()) as { result?: unknown }).result : null))
    .catch(() => null);
  if (!Array.isArray(result)) throw new HttpError(502, INDEX_DOWN);
  return result as IndexLog[];
}

/** Every log of one event, paging past the 1,000-log cap by restarting at the highest block seen (that block's logs
 *  may run past the cap, so it is read again and deduplicated by tx hash + log index). */
async function eventLogs(merchantPay: Address, eventName: EventName, topics: Record<string, string> = {}): Promise<IndexLog[]> {
  const topic0 = toEventSelector(events.find((e) => e.name === eventName)!);
  const seen = new Map<string, IndexLog>();
  let fromBlock = 0n;
  for (let page = 0; page < INDEX_MAX_PAGES; page++) {
    const logs = await indexPage({ module: "logs", action: "getLogs", address: merchantPay, fromBlock: fromBlock.toString(), toBlock: "latest", topic0, ...topics });
    for (const log of logs) seen.set(`${log.transactionHash}:${log.logIndex}`, log);
    if (logs.length < INDEX_PAGE) return [...seen.values()];
    const last = logs.reduce((max, log) => (BigInt(log.blockNumber ?? 0) > max ? BigInt(log.blockNumber ?? 0) : max), fromBlock);
    if (last === fromBlock) break; // one block holds 1,000+ of these logs: can't page further
    fromBlock = last;
  }
  // ponytail: 10 pages (~10,000 logs) per event; a partial report would lie, so it refuses past that
  throw new HttpError(502, "This history is too long to report on yet.");
}

/** Decoded logs of MerchantPay only; anything else in the index answer is dropped. */
function decoded(merchantPay: Address, eventName: EventName, logs: IndexLog[]) {
  return logs.flatMap((log) => {
    try {
      if (log.address?.toLowerCase() !== merchantPay.toLowerCase() || !log.topics || !log.data || !log.timeStamp) return [];
      const event = decodeEventLog({ abi: events, eventName, data: log.data, topics: log.topics, strict: true });
      if (event.eventName !== eventName) return []; // viem decodes by topic0, whatever eventName says
      const { args } = event;
      const txHash = isHash(log.transactionHash ?? "") ? (log.transactionHash as Hex) : null;
      return [{ args, txHash, time: Number(BigInt(log.timeStamp)) * 1000 }];
    } catch {
      return []; // not a log we can read
    }
  });
}

/** The merchant's payments (Paid, indexed by merchant) and the refunds on them (Refunded isn't indexed by merchant,
 *  so the contract's refunds are fetched and kept by payment id). */
export async function merchantHistory(merchantPay: Address, merchant: Address): Promise<History> {
  const [paid, refundedLogs] = await Promise.all([
    eventLogs(merchantPay, "Paid", { topic2: pad(merchant).toLowerCase(), topic0_2_opr: "and" }),
    eventLogs(merchantPay, "Refunded"),
  ]);
  const mine = new Map<bigint, Omit<ChainPayment, "refunded">>();
  for (const { args, txHash, time } of decoded(merchantPay, "Paid", paid)) {
    const p = args as PaidArgs;
    if (p.merchant.toLowerCase() !== merchant.toLowerCase()) continue;
    mine.set(p.paymentId, { paymentId: p.paymentId, payer: p.payer, gross: p.gross, fee: p.fee, toInvestors: p.toInvestors, toMerchant: p.toMerchant, txHash, time });
  }
  const refunds = decoded(merchantPay, "Refunded", refundedLogs).flatMap(({ args, time }) => {
    const { paymentId, amount } = args as RefundedArgs;
    return mine.has(paymentId) ? [{ paymentId, amount, time }] : [];
  });
  const payments = [...mine.values()]
    .sort((a, b) => (a.paymentId < b.paymentId ? -1 : 1))
    .map((p) => ({ ...p, refunded: sum(refunds.filter((r) => r.paymentId === p.paymentId).map((r) => r.amount)) }));
  return { payments, refunds };
}

const within = (range: Range) => (item: { time: number }) => item.time >= range.start && item.time < range.end;
export const paymentsIn = (history: History, range: Range) => history.payments.filter(within(range));

// net = what the merchant's business got before refunds (toMerchant + toInvestors); fees = MerchantPay's relay fee
function totals(payments: ChainPayment[], refunds: ChainRefund[]) {
  return {
    gross: usdt(sum(payments.map((p) => p.gross))),
    fees: usdt(sum(payments.map((p) => p.fee))),
    net: usdt(sum(payments.map((p) => p.toMerchant + p.toInvestors))),
    refunds: usdt(sum(refunds.map((r) => r.amount))),
    count: payments.length,
  };
}

/** Every day in range in its time zone (zeros included), the totals, and new vs returning payers (paid this merchant before). */
export function report(history: History, range: Range) {
  const payments = paymentsIn(history, range);
  const refunds = history.refunds.filter(within(range));
  const count = (utcMidnight(range.to) - utcMidnight(range.from)) / DAY_MS + 1;
  const dates = Array.from({ length: count }, (_, i) => addDays(range.from, i));
  const fmt = dayFormatter(range.tz);
  const day = (ms: number) => fmt.format(ms);
  const before = new Set(history.payments.filter((p) => p.time < range.start).map((p) => p.payer.toLowerCase()));
  const payers = new Set(payments.map((p) => p.payer.toLowerCase()));
  const returningPayers = [...payers].filter((payer) => before.has(payer)).length;
  return {
    from: range.from,
    to: range.to,
    tz: range.tz,
    days: dates.map((date) => ({ date, ...totals(payments.filter((p) => day(p.time) === date), refunds.filter((r) => day(r.time) === date)) })),
    totals: totals(payments, refunds),
    kpis: { new_payers: payers.size - returningPayers, returning_payers: returningPayers }, // snake_case like the rest of the API
  };
}

const CSV_HEADER = ["payment_id", "created_utc", "currency", "gross", "fee", "to_investors", "net", "refunded", "payer", "tx_hash"];
const csvLine = (fields: string[]) => fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(",");

/** One row per payment in range, oldest first; `net` as in the report, `refunded` = all refunds on it so far. */
export function reportCsv(history: History, range: Range): string {
  const rows = paymentsIn(history, range).map((p) => [
    p.paymentId.toString(),
    new Date(p.time).toISOString(),
    "USDT",
    usdt(p.gross),
    usdt(p.fee),
    usdt(p.toInvestors),
    usdt(p.toMerchant + p.toInvestors),
    usdt(p.refunded),
    p.payer,
    p.txHash ?? "",
  ]);
  return `${[CSV_HEADER, ...rows].map(csvLine).join("\r\n")}\r\n`;
}
