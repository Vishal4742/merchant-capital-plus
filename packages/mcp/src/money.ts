// Money as integers only (batch 052, FR-MCP-14): a decimal string becomes bigint minor units at the currency's own
// precision, and back. No float ever touches an amount. The currencies are the gateway's (GET /api/v1/account
// price_currencies, apps/web lib/server/http.ts CURRENCIES, FR-GW-11); the precision is ISO 4217's minor unit for the
// fiat ones and the token's 6 decimals for USDT (packages/shared/contracts.ts).

export const CURRENCIES = ["USDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** Invoices settle in USDT and are issued in it (SRS v3.1 FR-BILL-1). A price in another currency is a link's job. */
export const INVOICE_CURRENCIES = ["USDT"] as const;

export const DIGITS: Record<Currency, number> = { USDT: 6, USD: 2, EUR: 2, GBP: 2, INR: 2, AED: 2, SGD: 2 };
const SYMBOL: Partial<Record<Currency, string>> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
const MAX_INTEGER_DIGITS = 12; // 999,999,999,999: far above any testnet payment, small enough to never be a typo we accept
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;
const GROUPED = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

export class MoneyError extends Error {}

export interface Money {
  currency: Currency;
  units: bigint; // minor units of `currency` (paise for INR, 1e-6 for USDT)
}

export const isCurrency = (value: string): value is Currency => (CURRENCIES as readonly string[]).includes(value);

/** "15000", "15,000.50" or "2000.5" in `currency` → minor units. Refuses floats' artefacts by construction: the input
 *  is text, and more decimals than the currency has is an error (never rounded away). `allowZero` for discounts. */
export function parseMoney(text: string, currency: Currency, name = "amount", { allowZero = false } = {}): Money {
  if (typeof text !== "string") throw new MoneyError(`${name} must be a decimal string like "25.00".`);
  const trimmed = text.trim();
  // a comma only as a thousands separator ("15,000.50"); "1,50" (a decimal comma) is refused, never read as 150
  if (trimmed.includes(",") && !GROUPED.test(trimmed)) throw new MoneyError(`${name} must use a dot for decimals, like "1.50"; commas only between thousands.`);
  const match = DECIMAL.exec(trimmed.replaceAll(",", ""));
  if (!match) throw new MoneyError(`${name} must be a positive decimal like "25.00" (digits and one dot; no sign, no symbol).`);
  const [, whole, fraction = ""] = match;
  const digits = DIGITS[currency];
  if (fraction.length > digits) throw new MoneyError(`${name} has ${fraction.length} decimals, but ${currency} has ${digits}. Give it like "${example(currency)}".`);
  if (whole.length > MAX_INTEGER_DIGITS) throw new MoneyError(`${name} is too large.`);
  const units = BigInt(whole) * 10n ** BigInt(digits) + BigInt(fraction.padEnd(digits, "0") || "0");
  if (units === 0n && !allowZero) throw new MoneyError(`${name} must be more than 0.`);
  return { currency, units };
}

const example = (currency: Currency) => (DIGITS[currency] === 2 ? "2000.00" : "25.50");

/** Minor units → "15000.00": the currency's decimals, at least two, no grouping (machine-readable). */
export function decimal(units: bigint, currency: Currency): string {
  const digits = DIGITS[currency], negative = units < 0n, abs = negative ? -units : units;
  const scale = 10n ** BigInt(digits);
  let fraction = (abs % scale).toString().padStart(digits, "0");
  while (fraction.length > 2 && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return `${negative ? "-" : ""}${abs / scale}${digits ? `.${fraction}` : ""}`;
}

/** "₹15,000.00" / "25.50 USDT": for people, next to the machine-readable decimal. */
export function display(units: bigint, currency: Currency): string {
  const [whole, fraction] = decimal(units, currency).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const text = fraction ? `${grouped}.${fraction}` : grouped;
  return SYMBOL[currency] ? `${SYMBOL[currency]}${text}` : `${text} ${currency}`;
}

/** A gateway decimal (any number of decimals up to the currency's) → minor units; for API replies, not user input. */
export function fromApi(text: string | number | null | undefined, currency: Currency): bigint {
  return parseMoney(String(text ?? "0"), currency, "an amount from Whiteflow", { allowZero: true }).units;
}

// ---- invoice arithmetic (FR-MCP-14): one rounding per step, half up, to the currency's minor unit -------------------

/** A percentage as basis points (1 bp = 0.01%): "18", "18.5", "12.75" → 1800, 1850, 1275. More than 2 decimals is refused. */
export function percentToBps(text: string, name: string, { max = 100 } = {}): bigint {
  const match = typeof text === "string" ? /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim()) : null;
  if (!match) throw new MoneyError(`${name} must be a percentage like "18" or "12.5" (at most 2 decimals).`);
  const bps = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  if (bps <= 0n || bps > BigInt(max) * 100n) throw new MoneyError(`${name} must be more than 0 and at most ${max}%.`);
  return bps;
}

/** units × bps / 10,000, rounded half up (amounts are never negative here). */
export const applyBps = (units: bigint, bps: bigint): bigint => (units * bps + 5_000n) / 10_000n;

export interface LineInput {
  description: string;
  quantity: number;
  unit_price: string;
}
export type DiscountInput = { type: "amount"; amount: string } | { type: "percent"; percent: string };
export interface TaxInput {
  name: string;
  rate_percent: string;
}

export interface Totals {
  lines: { description: string; quantity: number; unitPrice: bigint; amount: bigint }[];
  subtotal: bigint;
  discount: { type: "amount" | "percent"; bps: bigint | null; amount: bigint } | null;
  tax: { name: string; bps: bigint; amount: bigint } | null;
  total: bigint;
}

export const MAX_QUANTITY = 10_000;

/** Σ quantity × unit price − discount (fixed, or a percent of the subtotal) + tax (an explicit rate on the discounted
 *  subtotal). Rounding happens once for a percent discount and once for tax. Throws MoneyError on anything invalid. */
export function invoiceTotals(currency: Currency, lines: LineInput[], discount?: DiscountInput | null, tax?: TaxInput | null): Totals {
  if (!Array.isArray(lines) || lines.length === 0) throw new MoneyError("An invoice needs at least one line item.");
  const priced = lines.map((line, i) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_QUANTITY) {
      throw new MoneyError(`Line ${i + 1}: quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
    }
    const unitPrice = parseMoney(line.unit_price, currency, `Line ${i + 1} unit_price`).units;
    return { description: line.description, quantity: line.quantity, unitPrice, amount: unitPrice * BigInt(line.quantity) };
  });
  const subtotal = priced.reduce((sum, line) => sum + line.amount, 0n);
  let off: Totals["discount"] = null;
  if (discount) {
    if (discount.type === "amount") {
      const amount = parseMoney(discount.amount, currency, "discount amount").units;
      off = { type: "amount", bps: null, amount };
    } else if (discount.type === "percent") {
      const bps = percentToBps(discount.percent, "discount percent");
      off = { type: "percent", bps, amount: applyBps(subtotal, bps) };
    } else {
      throw new MoneyError('discount.type must be "amount" or "percent".');
    }
    if (off.amount >= subtotal) throw new MoneyError("The discount must be less than the subtotal.");
  }
  const taxable = subtotal - (off?.amount ?? 0n);
  let levy: Totals["tax"] = null;
  if (tax) {
    const name = typeof tax.name === "string" ? tax.name.trim() : "";
    if (!name || name.length > 40) throw new MoneyError("tax.name must be the tax's name, like \"GST\" (at most 40 characters).");
    const bps = percentToBps(tax.rate_percent, "tax rate_percent");
    levy = { name, bps, amount: applyBps(taxable, bps) };
  }
  return { lines: priced, subtotal, discount: off, tax: levy, total: taxable + (levy?.amount ?? 0n) };
}

export const bpsToPercent = (bps: bigint): string => {
  const whole = bps / 100n, rest = bps % 100n;
  return rest === 0n ? whole.toString() : `${whole}.${rest.toString().padStart(2, "0").replace(/0$/, "")}`;
};
