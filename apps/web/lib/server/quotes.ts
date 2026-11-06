// Server-only FX: the app's single FX source (human 05:4x; SRS FR-GW-11, ARCHITECTURE §4b). A price in a fiat currency
// becomes USDT, rounded UP to the cent (the merchant is never short), and a quote locks it for 10 minutes.
// Conventions match packages/sdk's `priced`: `rate` = units of the currency per 1 USD, `rateAt` = the source's publish
// date. USD and USDT are 1:1. EUR, GBP, INR, SGD and AED come from Frankfurter v2 (one request, cached 15 min); a rate
// outside its sanity band, or older than 7 days, is refused (agreed with claude-frontend 05:52; AED = its 3.6725 peg ±1%).
import { formatUnits, parseUnits } from "viem";
import { query } from "./db.ts";
import { HttpError, MAX_PAYMENT, MIN_PAYMENT, newId, type Currency } from "./http.ts";

export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const RATE_CACHE_MS = 15 * 60 * 1000;
const QUOTED = ["AED", "EUR", "GBP", "INR", "SGD"] as const;
const FRANKFURTER = `https://api.frankfurter.dev/v2/rates?base=usd&quotes=${QUOTED.join(",").toLowerCase()}`;
const FX_TIMEOUT_MS = 5_000;
const MAX_RATE_AGE_DAYS = 7;
const CENT = 10_000n; // USDT units in one cent
const DAY_MS = 24 * 60 * 60 * 1000;

/** Units of the currency per 1 USD that we accept: ±15% of the 06 Nov 2026 rates (human 06:18; a flipped EUR, GBP or
 *  SGD rate passed the old 0.5–2× band), AED at its 3.6725 peg ± 1%. The same numbers as claude-frontend (ARCHITECTURE §4b). */
export const BANDS: Record<(typeof QUOTED)[number], [number, number]> = {
  EUR: [0.7555, 1.0221], // 0.88875
  GBP: [0.6309, 0.8536], // 0.74225
  SGD: [1.0858, 1.469], // 1.2774
  INR: [80.33, 108.68], // 94.5
  AED: [3.635775, 3.709225],
};

/** Units of the currency per 1 USD, as an exact fraction (num / den), with how to show it. */
export interface Rate {
  num: bigint;
  den: bigint;
  rate: string; // per 1 USD, as the source gave it
  rateAt: string; // the source's publish date, YYYY-MM-DD
  source: string;
  fetchedAt: number;
}

export interface Quote {
  id: string;
  currency: Currency;
  amount: string; // the price as the merchant set it, in `currency`
  usdtAmount: bigint; // USDT units (6 decimals), a whole number of cents
  rate: string;
  rateAt: string;
  source: string;
  fetchedAt: number;
  expiresAt: number;
}

/** "0.88875" → 88875 / 100000. */
function fraction(decimal: string): { num: bigint; den: bigint } {
  const [whole, frac = ""] = decimal.split(".");
  return { num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) };
}

const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A real YYYY-MM-DD at most 7 days before `now`'s UTC day and not after tomorrow. */
function freshDate(date: string, now: number): boolean {
  const at = /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  if (!Number.isFinite(at) || utcDate(at) !== date) return false; // e.g. 2026-02-30
  return at >= Date.parse(`${utcDate(now)}T00:00:00Z`) - MAX_RATE_AGE_DAYS * DAY_MS && at <= now + DAY_MS;
}

/** A source row we trust: a fresh date, a plain decimal inside the band. */
function checked(currency: (typeof QUOTED)[number], row: { date?: unknown; rate?: unknown }, now: number, fetchedAt: number): Rate | null {
  const date = typeof row.date === "string" ? row.date : "";
  if (!freshDate(date, now)) return null;
  const text = typeof row.rate === "number" ? String(row.rate) : "";
  if (!/^\d+(\.\d{1,12})?$/.test(text)) return null;
  const [low, high] = BANDS[currency];
  if (Number(text) < low || Number(text) > high) return null;
  return { ...fraction(text), rate: text, rateAt: date, source: "Frankfurter (ECB and central-bank reference rates)", fetchedAt };
}

// ponytail: per-instance cache; each serverless instance fetches at most once per 15 min.
let cache: { fetchedAt: number; rates: Map<string, Rate> } | undefined;

async function fetchRates(now: number): Promise<Map<string, Rate>> {
  if (cache && now - cache.fetchedAt < RATE_CACHE_MS) return cache.rates;
  let rows: unknown;
  try {
    const res = await fetch(FRANKFURTER, { signal: AbortSignal.timeout(FX_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    rows = await res.json();
  } catch {
    if (cache) return cache.rates; // a stale-but-checked rate beats none; each row was band- and date-checked
    throw new HttpError(503, "Exchange rates are unavailable right now. Price in USD or USDT, or try again in a minute.");
  }
  const rates = new Map<string, Rate>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const quote = typeof row?.quote === "string" ? row.quote.toUpperCase() : "";
    if (row?.base === "USD" && (QUOTED as readonly string[]).includes(quote)) {
      const rate = checked(quote as (typeof QUOTED)[number], row, now, now);
      if (rate) rates.set(quote, rate);
    }
  }
  cache = { fetchedAt: now, rates };
  return rates;
}

export async function usdRate(currency: Currency, now = Date.now()): Promise<Rate> {
  if (currency === "USD" || currency === "USDT") return { num: 1n, den: 1n, rate: "1", rateAt: utcDate(now), source: "USD = USDT 1:1", fetchedAt: now };
  const rate = (await fetchRates(now)).get(currency);
  // re-checked here, not only at fetch time: during an outage the cache keeps serving, and it must not age past 7 days (S3)
  if (!rate || !freshDate(rate.rateAt, now)) throw new HttpError(503, `Prices in ${currency} are unavailable right now. Try again in a minute.`);
  return rate;
}

/** USDT units for `amount` of a currency at `rate` (per 1 USD), rounded UP to the cent: the merchant is never short. */
export function toUsdtUnits(amount: string, rate: Pick<Rate, "num" | "den">): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new HttpError(400, 'amount must be a decimal string like "20.00".');
  const scaled = parseUnits(amount, 6) * rate.den; // = USDT units × num
  const step = rate.num * CENT;
  return ((scaled + step - 1n) / step) * CENT;
}

export async function createQuote(amount: string, currency: Currency, now = Date.now()): Promise<Quote> {
  const rate = await usdRate(currency, now);
  const usdtAmount = toUsdtUnits(amount, rate);
  if (usdtAmount < MIN_PAYMENT || usdtAmount > MAX_PAYMENT) throw new HttpError(400, "That price is outside 1 to 1,000 USDT.");
  const quote: Quote = { id: newId("quote"), currency, amount, usdtAmount, rate: rate.rate, rateAt: rate.rateAt, source: rate.source, fetchedAt: rate.fetchedAt, expiresAt: now + QUOTE_TTL_MS };
  await query(
    "INSERT INTO app_gw_quotes (id, currency, amount, usdt_amount, rate, rate_at, source, fetched_at, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [quote.id, currency, amount, usdtAmount.toString(), quote.rate, quote.rateAt, quote.source, quote.fetchedAt, quote.expiresAt, now],
  );
  return quote;
}

/** The quote while it is locked, else null (expired or unknown). */
export async function getQuote(id: string, now = Date.now()): Promise<Quote | null> {
  const rows = await query<{ id: string; currency: Currency; amount: string; usdt_amount: string; rate: string; rate_at: string | null; source: string; fetched_at: string; expires_at: string }>(
    "SELECT id, currency, amount, usdt_amount::text, rate, rate_at, source, fetched_at::text, expires_at::text FROM app_gw_quotes WHERE id = $1 AND expires_at > $2",
    [id, now],
  );
  const r = rows[0];
  if (!r) return null;
  const fetchedAt = Number(r.fetched_at);
  return { id: r.id, currency: r.currency, amount: r.amount, usdtAmount: BigInt(r.usdt_amount), rate: r.rate, rateAt: r.rate_at ?? utcDate(fetchedAt), source: r.source, fetchedAt, expiresAt: Number(r.expires_at) };
}

/** The JSON shape of a quote in API responses. */
export const quoteJson = (q: Quote) => ({
  quote_id: q.id,
  currency: q.currency,
  amount: q.amount,
  usdt_amount: formatUnits(q.usdtAmount, 6),
  rate: q.rate,
  rate_at: q.rateAt,
  source: q.source,
  fetched_at: new Date(q.fetchedAt).toISOString(),
  expires_at: new Date(q.expiresAt).toISOString(),
});

/** packages/sdk's `priced` shape, for claude-frontend's session reply. */
export const pricedJson = (q: Quote) => ({ currency: q.currency, amount: q.amount, rate: q.rate, rateAt: q.rateAt, source: q.source });

/** Tests only: forget the cached rates. */
export const resetRateCache = () => {
  cache = undefined;
};
