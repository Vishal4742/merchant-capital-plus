// The dashboard's money screens (SRS FR-GW-12 vouchers, FR-GW-9 reports, FR-GW-10 settlements): the shapes they show,
// the browser's voucher calls to claude-contracts' routes (API.md, batch 007, parsed like lib/gateway-client.ts) and the
// checks run before a call. Our server reads the lists, reports and settlements from lib/server directly
// (lib/gateway-server.ts). Pure and browser-safe; field names stay snake_case, as on the wire. Amounts stay the API's
// decimal strings: the screens format them for display and never re-add them.
import { GatewayError, wire, type Transport } from "./gateway-client.ts";
import { amountText, type Checked } from "./gateway-forms.ts";
import { istDay } from "./dashboard.ts";
import { parseUsdt } from "./usdt.ts";

const { bad, record, text, nullable, decimal, count, flag, plainError, OFFLINE, TIMEOUT_MS } = wire;

export const REPORT_TZ = "Asia/Kolkata"; // the screens' days are India days (claude-contracts' batch 008 reads tz)
export const MAX_REPORT_DAYS = 92;
const DEFAULT_REPORT_DAYS = 7;
const DAY_MS = 86_400_000;
const MAX_FUTURE_MS = 5 * 365 * DAY_MS;
const MAX_USES = 100_000;
const USDT_MIN = 1_000_000n; // 1 USDT: the gateway's floor for a minimum order
const USDT_MAX = 1_000_000_000n; // 1,000 USDT: the testnet cap per payment
const CODE = /^[A-Z0-9_-]{3,32}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
// longer than the Arkiv SDK's 180 s receipt wait, which a publish can sit in (lib/server/vouchers.ts PUBLISH_LEASE_MS)
const PUBLISH_TIMEOUT_MS = 200_000;

export type VoucherKind = "percent" | "fixed";
export interface Voucher {
  id: string;
  code: string;
  kind: VoucherKind;
  value: string; // a whole percent, or USDT off
  expires_at: string;
  max_redemptions: number;
  times_redeemed: number;
  min_amount: string | null; // USDT
  active: boolean;
  arkiv_entity_key: string | null;
  created_at: string;
}
export interface VoucherBody {
  code: string;
  kind: VoucherKind;
  value: string;
  expires_at: string;
  max_redemptions: number;
  min_amount?: string;
}
export interface DayFigures {
  gross: string;
  fees: string;
  net: string;
  refunds: string;
  count: number;
}
export interface Report {
  from: string;
  to: string;
  days: (DayFigures & { date: string })[];
  totals: DayFigures;
  kpis: { new_payers: number; returning_payers: number };
}
export interface Settlement {
  payment_id: string;
  gross: string;
  fee: string;
  to_investors: string;
  net: string;
  tx_hash: string | null; // the explorer link is built from this, never taken from the answer
  settled_at: string;
}
export interface Settlements {
  balance: string;
  settlements: Settlement[];
}
/** Days `from`..`to` (YYYY-MM-DD, India time), both counted. */
export interface ReportRange {
  from: string;
  to: string;
}

// ── parsing ──
const kind = (v: unknown) => (v === "percent" || v === "fixed" ? v : bad());
const time = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : bad());
const hash = (v: unknown) => (typeof v === "string" && HASH.test(v) ? v : bad());

function voucherOf(v: unknown): Voucher {
  const r = record(v);
  return {
    id: text(r.id),
    code: text(r.code),
    kind: kind(r.kind),
    value: decimal(r.value),
    expires_at: time(r.expires_at),
    max_redemptions: count(r.max_redemptions),
    times_redeemed: count(r.times_redeemed),
    min_amount: nullable(r.min_amount, decimal),
    active: flag(r.active),
    arkiv_entity_key: nullable(r.arkiv_entity_key, hash),
    created_at: time(r.created_at),
  };
}

/** `from=…&to=…&tz=Asia/Kolkata`, for the CSV link and our server's report range alike. */
export const rangeQuery = (range: ReportRange) => new URLSearchParams({ from: range.from, to: range.to, tz: REPORT_TZ }).toString();
export const csvHref = (range: ReportRange) => `/api/v1/reports.csv?${rangeQuery(range)}`;

export function moneyClient({ fetch: send = fetch }: Transport = {}) {
  // ponytail: repeats gatewayClient's call() so batch 010's client is untouched while the Developers screen is built
  // beside it; fold the two into one exported call at merge.
  async function call(path: string, what: string, body?: unknown, timeoutMs = TIMEOUT_MS): Promise<unknown> {
    let res: Response;
    try {
      res = await send(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new GatewayError(0, OFFLINE);
    }
    const data: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw plainError(res.status, data, what);
    return data;
  }

  return {
    createVoucher: async (body: VoucherBody) => voucherOf(await call("/api/v1/vouchers", "Vouchers", body)),
    deactivateVoucher: async (id: string) => void (await call(`/api/v1/vouchers/${encodeURIComponent(id)}/deactivate`, "Vouchers", {})),
    /** Retries the Arkiv mirror of a code that isn't on Arkiv (FR-GW-12, batch 028); arkivError says why it still isn't. */
    publishVoucher: async (id: string) => {
      const data = await call(`/api/v1/vouchers/${encodeURIComponent(id)}/publish`, "Vouchers", {}, PUBLISH_TIMEOUT_MS);
      return { voucher: voucherOf(data), arkivError: nullable(record(data).arkiv_error, text) };
    },
  };
}

// ── checks before a call ──
const ok = <T>(value: T) => ({ ok: true, value }) as const;
const no = (error: string) => ({ ok: false, error }) as const;

/** USDT units of a typed amount, or null unless it is a plain decimal with at most 6 places. */
function units(typed: string): bigint | null {
  try {
    return parseUsdt(typed);
  } catch {
    return null;
  }
}

export interface VoucherForm {
  code: string;
  kind: string;
  value: string;
  expires: string; // a datetime-local value
  limit: string;
  minOrder: string; // "" for none
}

/** The new-voucher form checked by the gateway's own rules (lib/server/vouchers.ts voucherInput). */
export function voucherBody(f: VoucherForm, now = Date.now()): Checked<VoucherBody> {
  const code = f.code.trim().toUpperCase();
  if (!CODE.test(code)) return no("Use 3 to 32 letters, digits, - or _ for the code, like SAVE10.");
  if (f.kind !== "percent" && f.kind !== "fixed") return no("Choose percent off or a fixed amount off.");
  const value = f.value.trim();
  if (f.kind === "percent" && !(/^\d{1,3}$/.test(value) && Number(value) >= 1 && Number(value) <= 100)) return no("Enter a whole percent from 1 to 100.");
  const off = units(value);
  if (f.kind === "fixed" && (off === null || off <= 0n || off > USDT_MAX)) return no("Enter the amount off, like 5.00, up to 1,000 USDT.");
  const expires = Date.parse(f.expires);
  if (!f.expires.trim() || !(expires > now)) return no("Pick when the code stops working, in the future.");
  if (expires > now + MAX_FUTURE_MS) return no("Pick an end date within 5 years.");
  const limit = f.limit.trim();
  if (!(/^\d{1,6}$/.test(limit) && Number(limit) >= 1 && Number(limit) <= MAX_USES)) return no("Enter how many times the code can be used, from 1 to 100,000.");
  const body: VoucherBody = { code, kind: f.kind, value, expires_at: new Date(expires).toISOString(), max_redemptions: Number(limit) };
  const minOrder = f.minOrder.trim();
  if (!minOrder) return ok(body);
  const min = units(minOrder);
  if (min === null || min < USDT_MIN || min > USDT_MAX) return no("Enter a minimum order from 1.00 to 1,000.00 USDT, or leave it empty.");
  return ok({ ...body, min_amount: minOrder });
}

export type VoucherStatus = "active" | "off" | "expired" | "used_up";

/** What a payer would meet: a deactivated code first, then an expired one, then one with no uses left. */
export function voucherStatus(v: Voucher, now = Date.now()): VoucherStatus {
  if (!v.active) return "off";
  if (Date.parse(v.expires_at) <= now) return "expired";
  return v.times_redeemed >= v.max_redemptions ? "used_up" : "active";
}

/** The home's "Vouchers used" tile: redemptions across every code, and how many still work (null: unreadable). */
export function vouchersUsed(vouchers: readonly Voucher[] | null, now = Date.now()): { value: string; sub: string } {
  if (vouchers === null) return { value: "—", sub: "can't read vouchers now" };
  if (vouchers.length === 0) return { value: "0", sub: "No codes yet" };
  const used = vouchers.reduce((sum, v) => sum + v.times_redeemed, 0);
  const live = vouchers.filter((v) => voucherStatus(v, now) === "active").length;
  return { value: String(used), sub: `all time · ${live} of ${vouchers.length} ${vouchers.length === 1 ? "code" : "codes"} live` };
}

/** "10% off" or "5.00 USDT off". */
export const discountText = (v: Pick<Voucher, "kind" | "value">) => (v.kind === "percent" ? `${v.value}% off` : `${amountText(v.value)} USDT off`);

const dayText = (ms: number) => new Date(ms).toISOString().slice(0, 10);
function dayMs(text: string): number | null {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  return Number.isFinite(ms) && dayText(ms) === text ? ms : null; // 2026-02-30 doesn't survive the round trip
}

/** The report's days from the query: the last 7 India days by default, `from` ≤ `to`, at most 92 days. */
export function reportRange(from = "", to = "", now = Date.now()): Checked<ReportRange> {
  const toMs = to.trim() ? dayMs(to.trim()) : istDay(now) * DAY_MS;
  if (toMs === null) return no("Pick an end date.");
  const fromMs = from.trim() ? dayMs(from.trim()) : toMs - (DEFAULT_REPORT_DAYS - 1) * DAY_MS;
  if (fromMs === null) return no("Pick a start date.");
  if (fromMs > toMs) return no("The start date must be on or before the end date.");
  if ((toMs - fromMs) / DAY_MS + 1 > MAX_REPORT_DAYS) return no(`Pick a range of up to ${MAX_REPORT_DAYS} days.`);
  return ok({ from: dayText(fromMs), to: dayText(toMs) });
}

export interface Tile {
  label: string;
  value: string;
  sub: string;
}

/** The report's tiles: the API's totals as sent, formatted for display only (no sums, no differences). */
export function reportTiles(r: Report): { money: Tile[]; people: Tile[] } {
  const t = r.totals;
  return {
    money: [
      { label: "Gross", value: amountText(t.gross), sub: "USDT customers paid" },
      { label: "Fees", value: amountText(t.fees), sub: "USDT relay fees" },
      { label: "Net", value: amountText(t.net), sub: "USDT to you and investors" },
      { label: "Refunds", value: amountText(t.refunds), sub: "USDT sent back" },
    ],
    people: [
      { label: "Payments", value: String(t.count), sub: "in these days" },
      { label: "New payers", value: String(r.kpis.new_payers), sub: "first payment to you" },
      { label: "Returning payers", value: String(r.kpis.returning_payers), sub: "paid you before" },
    ],
  };
}

/** True when an amount the API sent is zero ("0", "0.00"). */
export const isZero = (amount: string) => units(amount) === 0n;

/** A time in India, like "6 Nov, 08:30". */
export const istText = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: REPORT_TZ });

/** A report day ("2026-11-06") as "6 Nov". */
export const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
