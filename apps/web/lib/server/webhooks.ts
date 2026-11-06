// Server-only webhooks (SRS FR-GW-7, FR-PAY-10): merchant endpoints, signed deliveries, retries, test send, replay.
// One delivery row per endpoint per event; its body is stored once and re-signed with a fresh timestamp on every
// attempt. The first attempt runs inline; retries run from POST /api/v1/webhooks/dispatch (cron secret).
// Outbound requests go only to public addresses (SSRF): checked on create and again before every attempt.
import { createHmac, randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { Address } from "viem";
import { query } from "./db.ts";
import { HttpError, httpsUrl, newId } from "./http.ts";

// Same format as claude-sdk's verifier (packages/sdk/index.ts signWebhook / constructEvent). Kept local so the Next
// build never pulls files from outside apps/web; test/gw-sdk-compat.test.mjs verifies it with the SDK and fails on drift.
export const SIGNATURE_HEADER = "MC-Signature";
/** `t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. */
export const signWebhook = (body: string, secret: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex")}`;

export type EventType = "payment.succeeded" | "payment.refunded";
const MAX_ENDPOINTS = 5;
export const TIMEOUT_MS = 5_000; // the Developers screen's "Answer within 5 s" (claude-frontend lib/gateway-dev.ts)
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000]; // after attempts 1, 2, 3; a 4th failure is final
const LEASE_MS = 60_000; // a delivery being attempted is hidden from dispatch this long (no double sends)
const DISPATCH_LIMIT = 50;
const RECENT_DELIVERIES = 20;

const blocked = new BlockList();
// this network, private, CGNAT, loopback, link-local, IETF, benchmarking, multicast + reserved + broadcast
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
// unspecified + loopback + v4-compatible, NAT64, 6to4, unique-local, link-local, multicast (v4-mapped ::ffff:a.b.c.d
// addresses are checked against the IPv4 rules by BlockList itself)
for (const [net, prefix] of [["::", 96], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}
const isBlocked = (ip: string) => blocked.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
const NOT_PUBLIC = "Webhook URLs must point to a public internet address.";

/** 400 unless every address the URL's host resolves to (A and AAAA) is public. */
// ponytail: fetch resolves the host again after this check (a DNS-rebinding window); pin the vetted IP with a custom
// undici dispatcher if that ever matters. Redirects are never followed, so a 3xx can't bounce us inside.
export async function assertPublicUrl(url: string): Promise<void> {
  const host = new URL(url).hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new HttpError(400, NOT_PUBLIC);
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await dns.lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new HttpError(400, "We couldn't find that host. Check the URL.");
    }
  }
  if (addresses.length === 0 || addresses.some(isBlocked)) throw new HttpError(400, NOT_PUBLIC);
}

const iso = (ms: number | string) => new Date(Number(ms)).toISOString();

type DeliveryRow = { id: string; webhook_id: string; event: string; status: string; attempts: number; next_attempt_at: string | null; response_status: number | null; created_at: string };
const DELIVERY_COLUMNS = "id, webhook_id, event, status, attempts, next_attempt_at::text, response_status, created_at::text";
const deliveryJson = (d: DeliveryRow) => ({
  id: d.id,
  event: d.event,
  status: d.status,
  attempts: Number(d.attempts),
  next_attempt_at: d.next_attempt_at === null ? null : iso(d.next_attempt_at),
  response_status: d.response_status === null ? null : Number(d.response_status),
  at: iso(d.created_at),
});
export type DeliveryJson = ReturnType<typeof deliveryJson>;

/** Adds an endpoint (at most 5 per merchant). The secret is returned here only. */
export async function createWebhook(merchant: Address, rawUrl: unknown, now = Date.now()) {
  const url = httpsUrl(rawUrl, "url");
  await assertPublicUrl(url);
  const id = newId("whk");
  const secret = `whsec_${randomBytes(32).toString("base64url")}`;
  const rows = await query(
    `INSERT INTO app_gw_webhooks (id, merchant, url, secret, created_at) SELECT $1, $2, $3, $4, $5
     WHERE (SELECT count(*) FROM app_gw_webhooks WHERE merchant = $2) < $6 RETURNING id`,
    [id, merchant.toLowerCase(), url, secret, now, MAX_ENDPOINTS],
  );
  if (rows.length !== 1) throw new HttpError(409, `You can have at most ${MAX_ENDPOINTS} webhook endpoints. Delete one first.`);
  return { id, url, secret, created_at: iso(now) };
}

/** The merchant's endpoints (never the secret), each with its last 20 deliveries, newest first. */
export async function listWebhooks(merchant: Address) {
  const m = merchant.toLowerCase();
  const hooks = await query<{ id: string; url: string; created_at: string }>("SELECT id, url, created_at::text FROM app_gw_webhooks WHERE merchant = $1 ORDER BY created_at DESC, id", [m]);
  const deliveries = await query<DeliveryRow>(
    `SELECT ${DELIVERY_COLUMNS} FROM (
       SELECT *, row_number() OVER (PARTITION BY webhook_id ORDER BY created_at DESC, id) AS rn FROM app_gw_deliveries WHERE merchant = $1
     ) d WHERE rn <= $2 ORDER BY created_at DESC, id`,
    [m, RECENT_DELIVERIES],
  );
  return hooks.map((h) => ({ id: h.id, url: h.url, created_at: iso(h.created_at), deliveries: deliveries.filter((d) => d.webhook_id === h.id).map(deliveryJson) }));
}

/** Whether a test event and a real payment.succeeded have each been answered with 2xx by one of the merchant's
 *  endpoints (claude-frontend's Developers setup checklist). A test event is the one sendTestEvent writes: data {test: true}. */
export async function deliveredEvents(merchant: Address): Promise<{ test: boolean; payment: boolean }> {
  const delivered = "FROM app_gw_deliveries WHERE merchant = $1 AND event = 'payment.succeeded' AND status = 'succeeded'";
  const isTest = "(body::jsonb #>> '{data,test}') = 'true'";
  const [row] = await query<{ test: boolean; payment: boolean }>(
    `SELECT EXISTS (SELECT 1 ${delivered} AND ${isTest}) AS test, EXISTS (SELECT 1 ${delivered} AND (${isTest}) IS NOT TRUE) AS payment`,
    [merchant.toLowerCase()],
  );
  return { test: row?.test === true, payment: row?.payment === true };
}

/** True if the merchant had this endpoint (its deliveries go with it). */
export async function deleteWebhook(merchant: Address, id: string): Promise<boolean> {
  return (await query("DELETE FROM app_gw_webhooks WHERE id = $1 AND merchant = $2 RETURNING id", [id, merchant.toLowerCase()])).length === 1;
}

/** One POST; the HTTP status, or null if it never got an answer (not public, network error, 5 s timeout). */
async function send(url: string, secret: string, body: string, now: number): Promise<number | null> {
  try {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signWebhook(body, secret, Math.floor(now / 1000)) },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {}); // the answer is never read or logged, only its status
    return res.status;
  } catch {
    return null; // recorded as a failed attempt; the error text can hold the merchant's URL, so it isn't logged
  }
}

/** Sends one delivery now and records the outcome: 2xx → succeeded; else retry at 1 m / 5 m / 30 m, failed after 4. */
export async function attemptDelivery(id: string, now = Date.now()): Promise<DeliveryJson | null> {
  const rows = await query<{ body: string; attempts: number; url: string; secret: string }>(
    "SELECT d.body, d.attempts, w.url, w.secret FROM app_gw_deliveries d JOIN app_gw_webhooks w ON w.id = d.webhook_id WHERE d.id = $1",
    [id],
  );
  const d = rows[0];
  if (!d) return null;
  const status = await send(d.url, d.secret, d.body, now);
  const attempts = Number(d.attempts) + 1;
  const succeeded = status !== null && status >= 200 && status < 300;
  const next = succeeded || attempts > RETRY_DELAYS_MS.length ? null : now + RETRY_DELAYS_MS[attempts - 1];
  const state = succeeded ? "succeeded" : next === null ? "failed" : "pending";
  const updated = await query<DeliveryRow>(
    `UPDATE app_gw_deliveries SET attempts = $2, status = $3, next_attempt_at = $4, response_status = $5 WHERE id = $1 RETURNING ${DELIVERY_COLUMNS}`,
    [id, attempts, state, next, status],
  );
  return updated[0] ? deliveryJson(updated[0]) : null;
}

type Endpoint = { id: string; merchant: string };
async function deliver(endpoints: Endpoint[], type: EventType, data: object, now: number, eventId = newId("evt")) {
  if (endpoints.length === 0) return [];
  const body = JSON.stringify({ id: eventId, type, created: Math.floor(now / 1000), data });
  const ids: string[] = [];
  for (const e of endpoints) {
    const id = newId("dlv");
    await query(
      "INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, next_attempt_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)",
      [id, e.id, e.merchant, eventId, type, body, now + LEASE_MS, now],
    );
    ids.push(id);
  }
  // the rows are recorded: an inline attempt that throws (a DB blip on its status UPDATE) leaves its delivery pending for
  // dispatch instead of failing the enqueue, which would make the caller re-enqueue (claude-frontend F2)
  return Promise.all(ids.map((id) => attemptDelivery(id, now).catch(() => null)));
}

/** Records the event for every endpoint of the merchant and makes the first attempt inline. `eventId` (events.ts derives
 *  it from the event's key) stays the same across a retried enqueue, so receivers can dedupe on it. */
export async function enqueueEvent(merchant: Address | string, type: EventType, data: object, now = Date.now(), eventId?: string) {
  const endpoints = await query<Endpoint>("SELECT id, merchant FROM app_gw_webhooks WHERE merchant = $1", [merchant.toLowerCase()]);
  return deliver(endpoints, type, data, now, eventId);
}

/** A payment.succeeded test event with data {test: true}, to one of the merchant's endpoints (404 otherwise). */
export async function sendTestEvent(merchant: Address, webhookId: string, now = Date.now()) {
  const endpoints = await query<Endpoint>("SELECT id, merchant FROM app_gw_webhooks WHERE id = $1 AND merchant = $2", [webhookId, merchant.toLowerCase()]);
  if (endpoints.length === 0) throw new HttpError(404, "No such webhook endpoint.");
  return (await deliver(endpoints, "payment.succeeded", { test: true }, now))[0];
}

/** Re-sends one of the merchant's deliveries now (404 otherwise). */
export async function replayDelivery(merchant: Address, deliveryId: string, now = Date.now()) {
  const own = await query("SELECT id FROM app_gw_deliveries WHERE id = $1 AND merchant = $2", [deliveryId, merchant.toLowerCase()]);
  if (own.length === 0) throw new HttpError(404, "No such delivery.");
  return attemptDelivery(deliveryId, now);
}

/** Attempts up to 50 pending deliveries that are due; returns how many. Claimed with a lease so runs don't overlap. */
export async function dispatchDue(now = Date.now()): Promise<number> {
  const due = await query<{ id: string }>(
    `UPDATE app_gw_deliveries SET next_attempt_at = $2 WHERE id IN (
       SELECT id FROM app_gw_deliveries WHERE status = 'pending' AND next_attempt_at <= $1 ORDER BY next_attempt_at LIMIT $3 FOR UPDATE SKIP LOCKED
     ) RETURNING id`,
    [now, now + LEASE_MS, DISPATCH_LIMIT],
  );
  await Promise.all(due.map((r) => attemptDelivery(r.id, now)));
  return due.length;
}
