// Shared helpers for the gateway API routes (batch 007): JSON errors, the signed-in merchant, input validation.
// Route handlers stay framework-free (they read the Request), so tests call them directly.
import { createHash, randomBytes, randomInt } from "node:crypto";
// next/navigation's server export of it: "next/navigation.js" is the browser module (it breaks route bundles), and the
// bare "next/navigation" doesn't resolve under Node's test runner. ponytail: an internal path; recheck on a Next upgrade.
import { unstable_rethrow } from "next/dist/client/components/unstable-rethrow.js";
import type { Address } from "viem";
import { SESSION_COOKIE, authSecret, cookieFrom, readSession } from "../auth.ts";
import { merchantConfig } from "../config.ts";
import { parseUsdt } from "../usdt.ts";
import { DbUnavailable, query } from "./db.ts";

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
  return jsonObject(await request.text(), maxBytes);
}

/** A body already read as text (a route that also hashes it for Idempotency-Key, batch 052) → a JSON object. */
export function jsonObject(text: string, maxBytes = 16_384): Record<string, unknown> {
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

/** Whether the pay pages show this shop's verified tick: only for a shop we actually checked (SRS v3.0 FR-BIZ-5), as a
 * name is the merchant's own text. ponytail: one checked shop today, the operator's configured MERCHANT_ADDRESS; a
 * per-merchant flag (World ID, FR-WLD-1, or business checks) replaces this body when it exists. */
export function merchantVerified(merchant: string): boolean {
  return merchantConfig()?.merchant.toLowerCase() === merchant.toLowerCase();
}

export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("base64url")}`;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** 10 random base62 characters (~59 bits): public slugs for links and pages. */
export const newSlug = () => Array.from({ length: 10 }, () => BASE62[randomInt(BASE62.length)]).join("");

const TOO_MANY = "Too many requests. Wait a minute and try again.";

// Per-instance memory: only sharedRateLimit's "memory" fallback uses it now (every route limits through Postgres).
const hits = new Map<string, { count: number; resetAt: number }>();
/** This instance's own window: at most `limit` calls per `windowMs` for this key (e.g. "quotes:<ip>"), else 429. */
export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): void {
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  hits.set(key, { ...entry, count: entry.count + 1 });
  if (entry.count + 1 > limit) throw new HttpError(429, TOO_MANY);
}

/** Tests only: forget this instance's in-memory windows. The shared ones are app_web_rate_limits rows, which
 *  gw-helpers resetDb() truncates with the other app_web_* tables. */
export const resetRateLimits = () => hits.clear();

// Batch 031-PW4 Part C (FR-REL-5, FR-REL-10 theme): limits shared by every instance and kept across restarts. One fixed
// window per key in app_web_rate_limits (db/052), counted by ONE statement: the upsert holds the key's row lock, so
// concurrent calls on any instance get distinct counts 1, 2, 3, ... with no read-then-write race. A window that has
// ended restarts at 1. `now` is this server's clock in unix ms (like the in-memory limiter, so tests can move time).
export const RATE_LIMIT_SQL = `INSERT INTO app_web_rate_limits AS r (key, count, reset_at) VALUES ($1, 1, $2::bigint + $3::bigint)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN r.reset_at <= $2::bigint THEN 1 ELSE r.count + 1 END,
  reset_at = CASE WHEN r.reset_at <= $2::bigint THEN $2::bigint + $3::bigint ELSE r.reset_at END
RETURNING count::text AS count`;
export const PRUNE_SQL = "DELETE FROM app_web_rate_limits WHERE reset_at < $1";
export const PRUNE_EVERY = 100; // calls per instance between sweeps of ended windows
const PRUNE_GRACE_MS = 60_000; // only windows that ended over a minute ago: room for clock skew between instances
const MAX_KEY = 200; // a longer key (an attacker's huge x-forwarded-for) is stored as its hash: btree rows stay small
/** The fixed refusal when the shared store can't be reached on a fail-closed route. */
export const RATE_LIMIT_DOWN = "We can't check request limits right now, so nothing was done and nothing was charged. Try again in a minute.";

/** What a shared limit does when Postgres is unreachable or not configured. "closed": refuse with 503 and
 *  RATE_LIMIT_DOWN (payment and money-adjacent routes: no limit check, no service). "memory": fall back to this
 *  instance's in-memory window (public reads that don't need the database, so they stay up and limited per instance). */
export type WhenDbDown = "closed" | "memory";

let sharedCalls = 0;

/** Deletes windows that ended over a minute before `now` (an ended window counts the same as no row). */
export async function pruneRateLimits(now = Date.now()): Promise<void> {
  await query(PRUNE_SQL, [now - PRUNE_GRACE_MS]);
}

/** At most `limit` calls per `windowMs` for this key across every instance and restart, else 429 (TOO_MANY). */
export async function sharedRateLimit(key: string, limit: number, windowMs: number, whenDbDown: WhenDbDown, now = Date.now()): Promise<void> {
  const stored = key.length <= MAX_KEY ? key : `sha256:${createHash("sha256").update(key).digest("hex")}`;
  let count: number;
  try {
    const [row] = await query<{ count: string }>(RATE_LIMIT_SQL, [stored, now, windowMs]);
    count = Number(row.count);
    if (!Number.isSafeInteger(count)) throw new TypeError("rate limit count");
  } catch (err) {
    // the error's name only: a driver message can hold the connection string
    if (!(err instanceof DbUnavailable)) console.error("rate limit store unavailable:", err instanceof Error ? err.name : typeof err);
    if (whenDbDown === "memory") return rateLimit(key, limit, windowMs, now);
    throw new HttpError(503, RATE_LIMIT_DOWN);
  }
  if (++sharedCalls % PRUNE_EVERY === 0) {
    await pruneRateLimits(now).catch((err: unknown) => console.error("rate limit prune failed:", err instanceof Error ? err.name : typeof err));
  }
  if (count > limit) throw new HttpError(429, TOO_MANY);
}

/** The caller's IP as Vercel reports it (first x-forwarded-for hop), for rate limits only. */
export const clientIp = (request: Request) => (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
