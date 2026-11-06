// Server-only FX quotes for prices in other currencies (FR-GW-11): display and quote only, no money is converted.
// Source: Frankfurter v2 (no key, free to use, rates update once a day). Each answer row is {date, base, quote, rate}:
// `rate` units of `quote` per 1 USD. 1 USDT = 1 USD. Rates are cached at most 15 minutes (ARCHITECTURE §4b), and a
// checkout priced in another currency locks its quote for 10 minutes (human, 03:02).
import { parseUsdt } from "./usdt.ts";

export const CURRENCIES = ["USDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

export const FX_SOURCE = "frankfurter.dev";
const QUOTED = ["AED", "EUR", "GBP", "INR", "SGD"];
const FX_URL = `https://api.frankfurter.dev/v2/rates?base=usd&quotes=${QUOTED.join(",").toLowerCase()}`;
const FX_TIMEOUT_MS = 5_000;
const FX_CACHE_MS = 15 * 60 * 1000;
/** How long a checkout priced in EUR, GBP, INR, AED or SGD keeps its quote: it expires then. */
export const QUOTE_LOCK_MS = 10 * 60 * 1000;
const UNITS_PER_CENT = 10_000n; // USDT has 6 decimals
const DECIMAL = /^\d+(\.\d+)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RATE_AGE_DAYS = 7;
const AED_PEG = 3.6725; // AED per USD, the UAE dirham's peg (Central Bank of the UAE)

// The sanity limit (security review 006 F1, human 05:4x): one outside host sets these prices, so a rate is used only if
// one unit of the currency is worth between these many USD. "Today" is Frankfurter's rate of 5 Nov 2026.
const USD_PER_UNIT: Record<string, readonly [number, number]> = {
  EUR: [0.5, 2], // today 1.125
  GBP: [0.6, 2.5], // today 1.347
  SGD: [0.4, 1.5], // today 0.783
  INR: [0.005, 0.03], // today 0.0106
  AED: [1 / (AED_PEG * 1.01), 1 / (AED_PEG * 0.99)], // the peg ±1%: today exactly 3.6725
};

export interface Quote {
  usdt: bigint; // USDT units, a whole number of cents (rounded up): exactly what the customer is charged
  rate: string; // units of the priced currency per 1 USD, as the source sent it
  rateDate: string; // YYYY-MM-DD the source published the rate for
  fetchedAt: number; // ms, when our server fetched it
  source: string;
}

export class FxUnavailableError extends Error {
  currency: string;
  constructor(currency: string) {
    super(`Prices in ${currency} are unavailable right now`);
    this.name = "FxUnavailableError";
    this.currency = currency;
  }
}

/** `amount` of a currency at `rate` per USD, in USDT units rounded UP to the cent, in exact integer maths: the merchant
 *  is never short, and the result matches claude-contracts' quotes module, the single FX source (human 05:4x). */
export function toUsdt(amount: string, rate: string): bigint {
  const units = parseUsdt(amount);
  const [whole, frac = ""] = rate.split(".");
  if (!DECIMAL.test(rate) || BigInt(whole + frac) === 0n) throw new Error(`Bad FX rate ${rate}`);
  // cents = units / rate / UNITS_PER_CENT = units · 10^frac / (rate · 10^frac · UNITS_PER_CENT); up = ⌈n / d⌉ = ⌊(n + d − 1) / d⌋
  const num = units * 10n ** BigInt(frac.length), den = BigInt(whole + frac) * UNITS_PER_CENT;
  return ((num + den - 1n) / den) * UNITS_PER_CENT;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A real YYYY-MM-DD at most 7 days before today and at most tomorrow (UTC): a stale or future rate isn't used. */
function recent(date: string, now: number): boolean {
  const at = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(at) || utcDay(at) !== date) return false; // "2026-02-30" isn't a day
  const today = Date.parse(`${utcDay(now)}T00:00:00Z`);
  return at >= today - MAX_RATE_AGE_DAYS * DAY_MS && at <= today + DAY_MS;
}

/** One unit of `currency` at `rate` per USD is worth a sane number of USD. */
function inBand(currency: string, rate: number): boolean {
  const band = USD_PER_UNIT[currency];
  return band !== undefined && 1 / rate >= band[0] && 1 / rate <= band[1];
}
type Rates = { fetchedAt: number; rates: Map<string, { rate: string; date: string }> };
// ponytail: one cache per server instance; a failed or partial answer is never cached
let cached: Rates | undefined;

async function latestRates(now: number): Promise<Rates> {
  if (cached && now >= cached.fetchedAt && now - cached.fetchedAt < FX_CACHE_MS) return cached;
  const res = await fetch(FX_URL, { signal: AbortSignal.timeout(FX_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`answered ${res.status}`);
  const rows: unknown = await res.json();
  if (!Array.isArray(rows)) throw new Error("sent no rows");
  const rates = new Map<string, { rate: string; date: string }>();
  for (const row of rows as { date?: unknown; base?: unknown; quote?: unknown; rate?: unknown }[]) {
    const rate = String(row?.rate); // a JSON number's shortest form is its decimal text, e.g. "0.88877"
    const valid = row?.base === "USD" && typeof row.quote === "string" && typeof row.rate === "number" && DECIMAL.test(rate) && row.rate > 0;
    if (valid && inBand(row.quote as string, row.rate as number) && typeof row.date === "string" && recent(row.date, now)) rates.set(row.quote as string, { rate, date: row.date });
  }
  const missing = QUOTED.filter((currency) => !rates.has(currency));
  if (missing.length) throw new Error(`sent no usable rate for ${missing.join(", ")}`);
  cached = { fetchedAt: now, rates };
  return cached;
}

/** The USDT price of `amount` in `currency`, with the rate it used. USDT is charged exactly, USD 1:1 to the cent;
 *  the rest at Frankfurter's latest rate. Throws FxUnavailableError (plain words) when there is no rate to use. */
export async function quote(currency: Currency, amount: string, now = Date.now()): Promise<Quote> {
  const usd = { rate: "1", rateDate: utcDay(now), fetchedAt: now, source: "1 USDT = 1 USD" };
  if (currency === "USDT") return { usdt: parseUsdt(amount), ...usd };
  if (currency === "USD") return { usdt: toUsdt(amount, "1"), ...usd };
  let latest: Rates;
  try {
    latest = await latestRates(now);
  } catch (error) {
    console.error(`fx: ${FX_SOURCE} ${error instanceof Error ? error.message : String(error)}`);
    throw new FxUnavailableError(currency);
  }
  const found = latest.rates.get(currency);
  if (!found) throw new FxUnavailableError(currency);
  return { usdt: toUsdt(amount, found.rate), rate: found.rate, rateDate: found.date, fetchedAt: latest.fetchedAt, source: FX_SOURCE };
}
