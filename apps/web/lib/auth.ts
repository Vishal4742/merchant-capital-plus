// Merchant sign-in with a wallet (SIWE, EIP-4361): the server hands out a one-time nonce, the merchant's
// wallet signs a sign-in message (no gas, no money), and the server sets an HMAC-signed session cookie.
// Server-only. No password and no email: the cookie, and each used nonce until it would have expired anyway.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { query } from "./server/db.ts";

export const SESSION_COOKIE = "mc_session";
export const NONCE_COOKIE = "mc_nonce";
export const SESSION_TTL_S = 8 * 60 * 60;
export const NONCE_TTL_S = 5 * 60;
/** A signed sign-in message may be valid for at most this long, so a captured signature soon dies. */
export const MAX_MESSAGE_TTL_S = 10 * 60;
const CLOCK_SKEW_MS = 60_000;
export const SIGN_IN_CHAIN_ID = 1874;

/** AUTH_SECRET signs the session cookie. Sign-in is off until it is set (at least 32 characters). */
export function authSecret(): string | undefined {
  const secret = process.env.AUTH_SECRET;
  return secret && secret.length >= 32 ? secret : undefined;
}

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest();
const tagOk = (payload: string, tag: string, secret: string) => {
  const given = Buffer.from(tag, "base64url"), expected = mac(payload, secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
};

export function signSession(address: Address, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ a: getAddress(address), e: now + SESSION_TTL_S * 1000 })).toString("base64url");
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}

/** The signed-in address, or null if the cookie is missing, forged, edited or expired. */
export function readSession(token: string | undefined, secret: string, now = Date.now()): Address | null {
  if (!token) return null;
  const [payload, tag, extra] = token.split(".");
  if (!payload || !tag || extra !== undefined || !tagOk(payload, tag, secret)) return null;
  try {
    const { a, e } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { a?: unknown; e?: unknown };
    if (typeof a !== "string" || !isAddress(a) || typeof e !== "number" || e <= now) return null;
    return getAddress(a);
  } catch {
    return null;
  }
}

// The nonce cookie carries the nonce, when we issued it, and our HMAC. A cookie is caller-controlled, so a plain
// nonce would let anyone replay a captured signature by naming its nonce (plan review, batch 004).
export function signNonce(nonce: string, secret: string, now = Date.now()): string {
  const payload = `${nonce}.${now}`;
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}

/** The nonce if the cookie is one we issued in the last NONCE_TTL_S, else null. */
export function readNonce(token: string | undefined, secret: string, now = Date.now()): string | null {
  const [nonce, at, tag, extra] = (token ?? "").split(".");
  if (!nonce || !at || !tag || extra !== undefined || !tagOk(`${nonce}.${at}`, tag, secret)) return null;
  const issued = Number(at);
  return Number.isSafeInteger(issued) && now - issued <= NONCE_TTL_S * 1000 && issued <= now + CLOCK_SKEW_MS ? nonce : null;
}

// Nonces already used for a sign-in (app_web_nonces), until their cookie would have expired anyway: a captured request
// can't be replayed inside the 5 min window, on this instance or any other.
const NONCE_KEEP_MS = NONCE_TTL_S * 1000 + CLOCK_SKEW_MS;

/** True the first time a nonce is used, on any instance; false after that (one INSERT: two at once, one wins). */
export async function consumeNonce(nonce: string, now = Date.now()): Promise<boolean> {
  await query("DELETE FROM app_web_nonces WHERE used_at <= $1", [now - NONCE_KEEP_MS]);
  const rows = await query("INSERT INTO app_web_nonces (nonce, used_at) VALUES ($1, $2) ON CONFLICT (nonce) DO NOTHING RETURNING nonce", [nonce, now]);
  return rows.length === 1;
}

/** Checks a SIWE message (our domain, the nonce we issued, chain 1874, expiring within 10 min) and its signature. */
/** The hosts a sign-in message may name: the request's own; under `next start`, which reports every request as
 *  localhost, the loopback spellings of the same port too (the browser may be on 127.0.0.1: G2 run, 06:30); and
 *  PUBLIC_ORIGIN's host behind a proxy. A phishing site's domain is never one of them. */
export function signInDomains(requestUrl: string, publicOrigin: string | undefined = process.env.PUBLIC_ORIGIN): string[] {
  const url = new URL(requestUrl);
  const hosts = new Set([url.host]);
  if (url.hostname === "localhost") for (const loopback of ["127.0.0.1", "[::1]"]) hosts.add(url.port ? `${loopback}:${url.port}` : loopback);
  if (publicOrigin && URL.canParse(publicOrigin) && /^https?:$/.test(new URL(publicOrigin).protocol)) hosts.add(new URL(publicOrigin).host);
  return [...hosts];
}

export async function verifySignIn(input: { message: string; signature: Hex; nonce: string; domains: readonly string[]; now?: Date }): Promise<Address | null> {
  if (input.message.length > 2_000) return null;
  const parsed = parseSiweMessage(input.message);
  const now = input.now ?? new Date();
  if (!parsed.address || parsed.chainId !== SIGN_IN_CHAIN_ID) return null;
  // viem only checks expiry when the message has one: require it, and keep it short
  if (!parsed.expirationTime || parsed.expirationTime.getTime() > now.getTime() + MAX_MESSAGE_TTL_S * 1000) return null;
  // the message must name one of our hosts (no phishing site's); viem then checks nonce, time and that same domain
  if (!parsed.domain || !input.domains.includes(parsed.domain)) return null;
  if (!validateSiweMessage({ message: parsed, nonce: input.nonce, domain: parsed.domain, time: now })) return null;
  const valid = await verifyMessage({ address: parsed.address, message: input.message, signature: input.signature }).catch(() => false);
  return valid ? getAddress(parsed.address) : null;
}

/** Reads one cookie from a request's Cookie header (route handlers stay framework-free and testable). */
export function cookieFrom(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return undefined; // a malformed %-escape is just a missing cookie, not a server error
    }
  }
  return undefined;
}

export function setCookie(name: string, value: string, maxAgeS: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${secure ? "; Secure" : ""}`;
}
