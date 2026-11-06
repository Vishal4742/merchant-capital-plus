// Shared helpers for the gateway API routes (batch 007): JSON errors, the signed-in merchant, input validation.
// Route handlers stay framework-free (they read the Request), so tests call them directly.
import { randomBytes, randomInt } from "node:crypto";
// next/navigation's server export of it: "next/navigation.js" is the browser module (it breaks route bundles), and the
// bare "next/navigation" doesn't resolve under Node's test runner. ponytail: an internal path; recheck on a Next upgrade.
import { unstable_rethrow } from "next/dist/client/components/unstable-rethrow.js";
import type { Address } from "viem";
import { SESSION_COOKIE, authSecret, cookieFrom, readSession } from "../auth.ts";
import { merchantConfig } from "../config.ts";
import { parseUsdt } from "../usdt.ts";
import { DbUnavailable } from "./db.ts";

export const MIN_PAYMENT = 1_000_000n; // 1 USDT, MerchantPay's minimum payment
export const MAX_PAYMENT = 1_000_000_000n; // 1,000 USDT per payment on testnet (ARCHITECTURE §4b safety cap)
export const CURRENCIES = ["USDT", "USD", "EUR", "GBP", "INR", "AED", "SGD"] as const; // SRS FR-GW-11
export type Currency = (typeof CURRENCIES)[number];

const NO_STORE = { "cache-control": "no-store" };

/** A client mistake with the status and the message the caller sees. */
export class HttpError extends Error {
  readonly status: number; // a plain field: Node's type stripping can't run TS parameter properties
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const fail = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });
export const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/** Runs a route body: HttpError → its status; anything else → a 500 that names no internals (NFR-8). Next's own
 *  errors go back to Next first: at build it prerenders each GET route and stops one that reads the Request by
 *  throwing, which this catch would otherwise log and answer as a 500 (batch 038). */
export async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof HttpError) return fail(err.status, err.message);
    if (err instanceof DbUnavailable) return fail(503, "The gateway isn't set up on this server yet.");
    console.error("gateway api error:", err instanceof Error ? err.name : typeof err); // never the message: it can hold SQL or URLs
    return fail(500, "Something went wrong on our side. Try again.");
  }
}

/** The merchant signed in to the dashboard (the SIWE session cookie), or 401. */
export function signedInMerchant(request: Request): Address {
  const secret = authSecret();
  const merchant = secret ? readSession(cookieFrom(request, SESSION_COOKIE), secret) : null;
  if (!merchant) throw new HttpError(401, "Sign in to your merchant dashboard first.");
  return merchant;
}

/** The request body as a JSON object, at most `maxBytes`. */
export async function readJson(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "That request is too large.");
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Send a JSON body.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Send a JSON object.");
  return body as Record<string, unknown>;
}

/** A USDT amount sent as a decimal string ("25.00"), between 1 and 1,000 USDT. */
export function usdtField(value: unknown, name = "amount"): bigint {
  if (typeof value !== "string") throw new HttpError(400, `${name} must be a decimal string like "25.00".`);
  let units: bigint;
  try {
    units = parseUsdt(value);
  } catch {
    throw new HttpError(400, `${name} must be a decimal string like "25.00" (at most 6 decimals).`);
  }
  if (units < MIN_PAYMENT || units > MAX_PAYMENT) throw new HttpError(400, `${name} must be between 1 and 1,000.`);
  return units;
}

export function textField(value: unknown, name: string, { max = 200, required = true } = {}): string {
  if (value !== undefined && value !== null && typeof value !== "string") throw new HttpError(400, `${name} must be text.`);
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) throw new HttpError(400, `${name} must be text of at most ${max} characters.`);
  if (!text && required) throw new HttpError(400, `${name} is required.`); // after the trim: "   " is empty
  return text;
}

export function currencyField(value: unknown): Currency {
  const c = typeof value === "string" ? value.toUpperCase() : "";
  if (!(CURRENCIES as readonly string[]).includes(c)) throw new HttpError(400, `currency must be one of ${CURRENCIES.join(", ")}.`);
  return c as Currency;
}

/** An https URL (no credentials in it), or 400. */
export function httpsUrl(value: unknown, name: string, { max = 500 } = {}): string {
  const text = textField(value, name, { max });
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, `${name} must be a full https:// URL.`);
  }
  if (url.protocol !== "https:" || url.username || url.password) throw new HttpError(400, `${name} must be an https:// URL.`);
  return url.toString();
}

export const MAX_FUTURE_MS = 5 * 365 * 24 * 60 * 60 * 1000; // expiries beyond 5 years are refused (and would break ISO output)

/** A time sent as unix milliseconds or an ISO date, in the future and at most 5 years away. */
export function futureTime(value: unknown, name: string, now = Date.now()): number {
  const ms = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms) || ms <= now) throw new HttpError(400, `${name} must be a time in the future.`);
  if (ms > now + MAX_FUTURE_MS) throw new HttpError(400, `${name} must be within 5 years.`);
  return Math.trunc(ms);
}

/** The name shown to payers: the configured shop name for the demo merchant, else a short address. */
export function merchantName(merchant: Address): string {
  const config = merchantConfig();
  if (config && config.merchant.toLowerCase() === merchant.toLowerCase()) return config.merchantName;
  return `${merchant.slice(0, 6)}…${merchant.slice(-4)}`;
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("base64url")}`;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** 10 random base62 characters (~59 bits): public slugs for links and pages. */
export const newSlug = () => Array.from({ length: 10 }, () => BASE62[randomInt(BASE62.length)]).join("");

// ponytail: per-instance memory, so the limit is per serverless instance; move to Postgres if abuse shows up.
const hits = new Map<string, { count: number; resetAt: number }>();
/** At most `limit` calls per `windowMs` for this key (e.g. "quotes:<ip>"), else 429. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): void {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  hits.set(key, { ...entry, count: entry.count + 1 });
  if (entry.count + 1 > limit) throw new HttpError(429, "Too many requests. Wait a minute and try again.");
}

/** Tests only: forget every rate-limit window (gw-helpers resetDb calls it between tests). */
export const resetRateLimits = () => hits.clear();

/** The caller's IP as Vercel reports it (first x-forwarded-for hop), for rate limits only. */
export const clientIp = (request: Request) => (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
