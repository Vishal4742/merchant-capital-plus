// Server-only FX quotes (SRS FR-GW-11, ARCHITECTURE §4b): a price in a fiat currency converted to USDT, locked 10 min.
// USD and USDT are 1:1 (checkout says so). EUR, GBP, INR and SGD use ECB reference rates via Frankfurter (no key),
// cached 15 min. AED is not an ECB currency: it is pegged at 3.6725 AED per USD by the Central Bank of the UAE (since 1997).
import { formatUnits, parseUnits } from "viem";
import { query } from "./db.ts";
import { HttpError, MAX_PAYMENT, MIN_PAYMENT, newId, type Currency } from "./http.ts";

export const QUOTE_TTL_MS = 10 * 60 * 1000;
export const RATE_CACHE_MS = 15 * 60 * 1000;
const FRANKFURTER = "https://api.frankfurter.dev/v1/latest";
const FX_TIMEOUT_MS = 5_000;

/** USD per one unit of the currency, as an exact fraction (num / den) plus how to show it. */
export interface Rate {
  num: bigint;
  den: bigint;
  rate: string;
  source: string;
  fetchedAt: number;
}

export interface Quote {
  id: string;
  currency: Currency;
  amount: string; // the price as the merchant set it, in `currency`
  usdtAmount: bigint; // USDT units (6 decimals)
  rate: string;
  source: string;
  fetchedAt: number;
  expiresAt: number;
}

/** "1.1224" → 11224 / 10000. */
function fraction(decimal: string): { num: bigint; den: bigint } {
  const [whole, frac = ""] = decimal.split(".");
  return { num: BigInt(whole + frac), den: 10n ** BigInt(frac.length) };
}

// ponytail: per-instance cache; each serverless instance fetches at most once per 15 min per currency.
const cache = new Map<Currency, Rate>();

export async function usdRate(currency: Currency, now = Date.now()): Promise<Rate> {
  if (currency === "USD" || currency === "USDT") return { num: 1n, den: 1n, rate: "1", source: "USD = USDT 1:1", fetchedAt: now };
  if (currency === "AED") return { num: 10_000n, den: 36_725n, rate: "0.272294", source: "AED peg 3.6725 per USD (Central Bank of the UAE)", fetchedAt: now };
  const hit = cache.get(currency);
  if (hit && now - hit.fetchedAt < RATE_CACHE_MS) return hit;
  let body: { date?: unknown; rates?: Record<string, unknown> };
  try {
    const res = await fetch(`${FRANKFURTER}?base=${currency}&symbols=USD`, { signal: AbortSignal.timeout(FX_TIMEOUT_MS), cache: "no-store" });
    if (!res.ok) throw new Error(`status ${res.status}`);
    body = (await res.json()) as typeof body;
  } catch {
    throw new HttpError(503, "Exchange rates are unavailable right now. Price in USD or USDT, or try again in a minute.");
  }
  const usd = body.rates?.USD;
  const text = typeof usd === "number" ? String(usd) : "";
  if (!/^\d+(\.\d{1,12})?$/.test(text) || Number(text) <= 0) throw new HttpError(503, "The exchange-rate source sent an unusable rate. Try again in a minute.");
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "latest";
  const rate: Rate = { ...fraction(text), rate: text, source: `ECB reference rate ${date} via Frankfurter`, fetchedAt: now };
  cache.set(currency, rate);
  return rate;
}

/** USDT units for `amount` of `currency`, rounded up (the merchant never gets less than its price). */
export function toUsdtUnits(amount: string, rate: Pick<Rate, "num" | "den">): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new HttpError(400, 'amount must be a decimal string like "20.00".');
  const units = parseUnits(amount, 6) * rate.num;
  return (units + rate.den - 1n) / rate.den;
}

export async function createQuote(amount: string, currency: Currency, now = Date.now()): Promise<Quote> {
  const rate = await usdRate(currency, now);
  const usdtAmount = toUsdtUnits(amount, rate);
  if (usdtAmount < MIN_PAYMENT || usdtAmount > MAX_PAYMENT) throw new HttpError(400, "That price is outside 1 to 1,000 USDT.");
  const quote: Quote = { id: newId("quote"), currency, amount, usdtAmount, rate: rate.rate, source: rate.source, fetchedAt: rate.fetchedAt, expiresAt: now + QUOTE_TTL_MS };
  await query(
    "INSERT INTO app_gw_quotes (id, currency, amount, usdt_amount, rate, source, fetched_at, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [quote.id, currency, amount, usdtAmount.toString(), quote.rate, quote.source, quote.fetchedAt, quote.expiresAt, now],
  );
  return quote;
}

/** The quote while it is locked, else null (expired or unknown). */
export async function getQuote(id: string, now = Date.now()): Promise<Quote | null> {
  const rows = await query<{ id: string; currency: Currency; amount: string; usdt_amount: string; rate: string; source: string; fetched_at: string; expires_at: string }>(
    "SELECT id, currency, amount, usdt_amount::text, rate, source, fetched_at::text, expires_at::text FROM app_gw_quotes WHERE id = $1 AND expires_at > $2",
    [id, now],
  );
  const r = rows[0];
  if (!r) return null;
  return { id: r.id, currency: r.currency, amount: r.amount, usdtAmount: BigInt(r.usdt_amount), rate: r.rate, source: r.source, fetchedAt: Number(r.fetched_at), expiresAt: Number(r.expires_at) };
}

/** The JSON shape of a quote in API responses. */
export const quoteJson = (q: Quote) => ({
  quote_id: q.id,
  currency: q.currency,
  amount: q.amount,
  usdt_amount: formatUnits(q.usdtAmount, 6),
  rate: q.rate,
  source: q.source,
  fetched_at: new Date(q.fetchedAt).toISOString(),
  expires_at: new Date(q.expiresAt).toISOString(),
});
