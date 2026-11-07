// The merchant's Capital rules (batch 036, docs/CAPITAL-TAB.md §4 M1-M3): the listing forms refuse what CapitalMarket
// refuses (BadTerms, CapitalMarket.sol:107-111, 136-141) before the wallet opens, the cost and the APR price in bigint,
// and the M1 state from what GET /api/v1/capital/merchant reads. Pure and client-safe; node:test covers it
// (test/ui-capital-merchant.test.mjs).
import { parseAbi, type Address } from "viem";
import type { merchantAdvance, OfferJson } from "../../../lib/server/capital.ts";
import { formatUsdt, parseUsdt } from "../../../lib/usdt.ts";

// packages/shared addresses and ABI (contracts frozen); the test pins this copy to it and to lib/server/capital.ts
export const CAPITAL_MARKET: Address = "0xecd63a369d23dfddc6bfac921e41a86760c20abe";
export const listingAbi = parseAbi([
  "function listAdvance(uint128 principal, uint128 cap, uint16 holdbackBps, uint64 term, uint64 offerDeadline) returns (uint256 claimId)",
  "function listInvoice(uint256 invoiceId, uint128 price, uint64 offerDeadline, uint16 recourseBps) returns (uint256 claimId)",
  "function cancelOffer(uint256 claimId)",
  "event OfferListed(uint256 indexed claimId, address indexed merchant, uint8 kind, uint256 invoiceId, uint256 face, uint256 price, uint16 bps, uint64 offerDeadline, uint64 maturity)",
  "error BadTerms()",
  "error AdvanceActive()",
  "error InvoiceNotListable()",
  "error NotMerchant()",
  "error AlreadyFunded()",
  "error OfferClosed()",
]);

/** CapitalMarket's errors as one sentence for the merchant (the dry run decodes them before the wallet asks). */
export const CAPITAL_COPY: Record<string, string> = {
  BadTerms: "CapitalMarket refused these terms. Check the amounts, the holdback and the deadline.",
  AdvanceActive: "You already have an advance. Wait until it's repaid, or cancel it if nobody has funded it.",
  InvoiceNotListable: "This invoice is already listed, paid, part paid or cancelled, so it can't be listed.",
  NotMerchant: "Switch to the wallet that owns this invoice or offer.",
  AlreadyFunded: "Investors have funded this offer, so it can't be cancelled.",
  OfferClosed: "This offer is already closed.",
};

export const MAX_OFFER_DAYS = 180; // the offer book's limit: an Arkiv entity lives at most ~182.5 days (CAPITAL-TAB §3.2)
export const LOCK_WINDOW_S = 60; // ClaimToken locks transfers this long before the due date (contracts.ts:21)
const MAX_HOLDBACK_BPS = 3000; // CapitalMarket.MAX_HOLDBACK_BPS: 30%
const MAX_APR_BPS = 10_000; // 100%: a guard on typing, not a contract rule
const MIN_USDT = 1_000_000n; // the relayer refuses a funding under 1 USDT, so a smaller advance could never be funded
const MAX_USDT = 1_000_000_000n; // 1,000 USDT, the testnet cap (ARCHITECTURE §4b)
const DAY_S = 86_400;
const IST_OFFSET_S = 19_800; // UTC+5:30, no daylight saving
const YEAR_DAYS = 365n;
const BPS = 10_000n;

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const no = (error: string): { ok: false; error: string } => ({ ok: false, error });

function usdt(text: string): bigint | null {
  try {
    const units = parseUsdt(text);
    return units > 0n ? units : null;
  } catch {
    return null;
  }
}

/** "20" → 2000, "12.5" → 1250: a percent with at most two decimals, else null. */
export function percentToBps(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return bps <= MAX_APR_BPS ? bps : null;
}

/** 2000 → "20", 1250 → "12.5", 1225 → "12.25". */
const percent = (bps: number) => (bps / 100).toString();

const TOO_PRECISE = /^\s*\d+\.\d{3,}\s*$/;
const CENT = 10_000n; // 0.01 USDT in base units

/** USDT amounts that share one line, in one decimal style (UX 036 F1, F2): the dashboard's "1,234.56" when every one is
 *  whole cents, else all six decimals, since an on-chain price like 98.065556 must not be rounded. */
export function usdtAmounts(...units: bigint[]): string[] {
  const cents = units.every((u) => u % CENT === 0n);
  return units.map((u) => {
    if (cents) return formatUsdt(u);
    const [whole, frac] = formatUsdt(u).split(".");
    return `${whole}.${frac.padEnd(6, "0")}`;
  });
}

/** An API amount ("1234.56", plainUsdt) as the dashboard shows it ("1,234.56"). */
export const usdtText = (plain: string) => formatUsdt(parseUsdt(plain));

export interface AdvanceForm {
  principal: string;
  cap: string;
  holdback: string;
  termDays: string;
  /** unix seconds */
  deadline: number;
}
export interface AdvanceTerms {
  principal: bigint;
  cap: bigint;
  holdbackBps: number;
  term: bigint;
  offerDeadline: bigint;
}

/** listAdvance's arguments, or the first rule they break: BadTerms (principal 0, cap < principal, holdback 0 or over
 *  30%, term 0, deadline not ahead) plus the offer book's limits. */
export function advanceTerms(f: AdvanceForm, now: number): Result<AdvanceTerms> {
  if (TOO_PRECISE.test(f.principal) || TOO_PRECISE.test(f.cap)) return no("Use at most 2 decimals, like 10.50.");
  const principal = usdt(f.principal);
  if (principal === null) return no("Enter the principal as an amount like 10.00.");
  if (principal < MIN_USDT || principal > MAX_USDT) return no("The principal must be from 1.00 to 1,000.00 USDT.");
  const cap = usdt(f.cap);
  if (cap === null) return no("Enter the cap as an amount like 11.00.");
  if (cap < principal || cap > MAX_USDT) return no("The cap must be at least the principal and at most 1,000.00 USDT: it's the most you repay.");
  const holdbackBps = percentToBps(f.holdback);
  if (holdbackBps === null) return no("Enter the holdback as a percent like 20.");
  if (holdbackBps === 0 || holdbackBps > MAX_HOLDBACK_BPS) return no("The holdback must be above 0% and at most 30% of each sale.");
  const termDays = /^\d{1,3}$/.test(f.termDays.trim()) ? Number(f.termDays) : 0;
  if (termDays < 1 || termDays > MAX_OFFER_DAYS) return no(`The term must be from 1 to ${MAX_OFFER_DAYS} days.`);
  if (!(f.deadline > now)) return no("Pick an offer deadline in the future.");
  if (f.deadline > now + termDays * DAY_S) return no("The offer deadline must come before the term ends.");
  return { ok: true, value: { principal, cap, holdbackBps, term: BigInt(termDays * DAY_S), offerDeadline: BigInt(f.deadline) } };
}

/** FR-ADV-6: what the advance costs, shown before the wallet opens. Listing moves no USDT; investors' USDT does. */
export function advanceCostLine(principal: bigint, cap: bigint, holdbackBps: number): string {
  const [get, repay, cost] = usdtAmounts(principal, cap, cap - principal);
  return `When investors fund it, you get ${get} USDT. You repay ${repay} USDT (cost ${cost} USDT) from ${percent(holdbackBps)}% of each sale until it's repaid.`;
}

/** CAPITAL-TAB G3: floor(face × 31,536,000 × 10,000 / (31,536,000 × 10,000 + aprBps × days × 86,400)), here with
 *  86,400 cancelled out of both sides (same quotient). Simple interest on a 365-day year. */
export const priceFromApr = (face: bigint, aprBps: number, days: number): bigint =>
  (face * YEAR_DAYS * BPS) / (YEAR_DAYS * BPS + BigInt(aprBps) * BigInt(days));

/** Calendar days in India from `now` to `dueDate` (unix s): the invoices UI sets the due date to 23:59:59 IST, so
 *  rounding the seconds up would price a "60 days" invoice at 61 (CAPITAL-TAB G3). */
export const daysToDue = (dueDate: number, now: number) => Math.floor((dueDate + IST_OFFSET_S) / DAY_S) - Math.floor((now + IST_OFFSET_S) / DAY_S);

export interface InvoiceForm {
  face: bigint;
  dueDate: number;
  apr: string;
  deadline: number;
}
export interface InvoiceTerms {
  price: bigint;
  offerDeadline: bigint;
  days: number;
  aprBps: number;
}

/** listInvoice's price and deadline, or the first rule they break: 0 < price < amount, deadline ahead and at least
 *  LOCK_WINDOW before the due date (CapitalMarket.sol:136-141), due date within the offer book's 180 days. */
export function invoiceTerms(f: InvoiceForm, now: number): Result<InvoiceTerms> {
  const aprBps = percentToBps(f.apr);
  if (TOO_PRECISE.test(f.apr)) return no("Use at most 2 decimals for the APR, like 12.5.");
  if (aprBps === null && Number(f.apr) > 100) return no("The APR must be at most 100%.");
  if (!aprBps) return no("Enter a target APR above 0%, like 12.");
  if (f.dueDate > now + MAX_OFFER_DAYS * DAY_S) return no(`This invoice is due more than ${MAX_OFFER_DAYS} days from now, too far out for the offer book.`);
  const days = daysToDue(f.dueDate, now);
  if (days < 1) return no("This invoice is due today, so it's too late to finance it.");
  const price = priceFromApr(f.face, aprBps, days);
  if (price <= 0n || price >= f.face) return no("At this APR the price isn't above 0 and below the invoice amount. Change the APR.");
  if (!(f.deadline > now)) return no("Pick an offer deadline in the future.");
  if (f.deadline > f.dueDate - LOCK_WINDOW_S) return no("The offer deadline must be at least a minute before the invoice is due.");
  return { ok: true, value: { price, offerDeadline: BigInt(f.deadline), days, aprBps } };
}

const aprText = (bps: number) => `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, "0")}%`;

/** FR-INV-2: the price and the APR it came from, side by side. */
export function invoicePriceLine(price: bigint, face: bigint, days: number, aprBps: number): string {
  const [pay, worth] = usdtAmounts(price, face);
  return `Investors pay ${pay} USDT now for ${worth} USDT due in ${days} ${days === 1 ? "day" : "days"} (${aprText(aprBps)} APR).`;
}

export type MerchantAdvance = Awaited<ReturnType<typeof merchantAdvance>>;
export type MerchantOffer = Pick<OfferJson, "id" | "kind" | "face" | "price" | "units_left" | "status" | "holdback_pct" | "offer_deadline" | "maturity" | "arkiv" | "debtor_ack">;
/** An offer as the page hands it to the browser: dates formatted once on the server, so hydration sees one string. */
export type OfferRow = MerchantOffer & { deadlineText: string };

/** Units investors have bought: face − units_left (both 1 unit = 0.000001 USDT). */
export const soldUnits = (o: Pick<MerchantOffer, "face" | "units_left">) => parseUsdt(o.face) - BigInt(o.units_left);

export type AdvanceState =
  | { kind: "none" }
  | { kind: "repaid"; claimId: string }
  | { kind: "open" | "expired"; claimId: string; offer: MerchantOffer | null }
  | { kind: "repaying"; claimId: string; cap: bigint; outstanding: bigint; repaid: bigint | null; holdbackPct: number };

/** M1 from GET /merchant: advanceOf is 0 once an advance settles (CapitalMarket.sol:364-369), so a repaid advance is
 *  the newest settled ("closed") advance among my offers; an unfunded one past its deadline has left the book. */
export function advanceState(advance: MerchantAdvance, offers: readonly MerchantOffer[]): AdvanceState {
  if (!advance) {
    const settled = offers.filter((o) => o.kind === "advance" && o.status === "closed").sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
    return settled[0] ? { kind: "repaid", claimId: settled[0].id } : { kind: "none" };
  }
  const offer = offers.find((o) => o.id === advance.claim_id) ?? null;
  const outstanding = parseUsdt(advance.outstanding);
  if (outstanding === 0n) return { kind: offer ? "open" : "expired", claimId: advance.claim_id, offer };
  const cap = parseUsdt(advance.cap);
  return { kind: "repaying", claimId: advance.claim_id, cap, outstanding, repaid: offer ? soldUnits(offer) - outstanding : null, holdbackPct: advance.holdback_pct };
}

/** One word or two for a row of "My live offers". */
export function offerLabel(o: MerchantOffer): string {
  if (o.status === "closed") return "Repaid";
  if (o.status === "funded") return o.kind === "advance" ? "Repaying" : "Funded";
  const face = parseUsdt(o.face);
  const sold = soldUnits(o);
  return sold === 0n || face === 0n ? "Open" : `Open · ${(sold * 100n) / face}% funded`;
}

// longer than the Arkiv SDK's 180 s receipt wait, which a publish can sit in (= vouchers, lib/gateway-money.ts): giving
// up sooner would offer Publish again while the first write may still land, and make a second entity (UX 036 F5)
export const PUBLISH_TIMEOUT_MS = 200_000;
const NOT_PUBLISHED = "The offer book didn't answer."; // the reason only: the screen says "isn't in the offer book yet"

/** POST /api/v1/capital/offers/{id}/publish (dashboard cookie): writes the offer's chain terms to Arkiv (FR-ARK-1).
 *  Returns the entity key; throws the server's own sentence, never a transport's text (it can name hosts). */
export async function publishOffer(claimId: string, send: typeof fetch = fetch): Promise<string> {
  if (!/^\d{1,78}$/.test(claimId)) throw new Error("That isn't a claim number.");
  let res: Response;
  try {
    res = await send(`/api/v1/capital/offers/${claimId}/publish`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: "{}",
      cache: "no-store",
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    });
  } catch {
    throw new Error(NOT_PUBLISHED);
  }
  const body: unknown = await res.json().catch(() => undefined);
  const { entity_key: key, error } = (body && typeof body === "object" ? body : {}) as { entity_key?: unknown; error?: unknown };
  if (res.ok && typeof key === "string") return key;
  throw new Error(typeof error === "string" && error ? error : NOT_PUBLISHED);
}
