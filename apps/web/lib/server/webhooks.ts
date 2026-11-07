// Server-only webhooks (SRS FR-GW-7, FR-PAY-10): merchant endpoints, signed deliveries, retries, test send, replay.
// One delivery row per endpoint per event; its body is stored once and re-signed with a fresh timestamp on every
// attempt. The first attempt runs inline; retries run from POST /api/v1/webhooks/dispatch (cron secret) and, where no
// frequent cron runs (Vercel Hobby), after busy reads (dispatchSoon).
// Outbound requests go only to public addresses (SSRF): checked on create and again before every attempt, and (batch 031
// round 4, A11) the connection itself goes only to the address that was checked, so DNS can't change in between.
import { createHmac, randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import { after } from "next/server.js"; // the .js path resolves under Node's test runner too
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
// Batch 031 round 2 (M1): an attempt must finish well inside its lease, so every step has a deadline: DNS 3 s (the
// lookup has no timeout of its own) + fetch 5 s (TIMEOUT_MS, which also covers fetch's own lookup). Dispatch runs at most
// DISPATCH_CONCURRENCY attempts at once over at most DISPATCH_LIMIT claims: ceil(30 / 10) × ~8 s ≈ 24 s < 60 s.
const DNS_TIMEOUT_MS = 3_000;
const FAMILY_GRACE_MS = 300; // after the first address family answers, how long the other may still add addresses
const DISPATCH_LIMIT = 30;
const DISPATCH_CONCURRENCY = 10;
// Round 4 (A11, fair scheduling): one destination (endpoint) gets at most this many attempts per dispatch run, so a
// hanging or slow destination with a backlog can never crowd healthy destinations out of a run.
const DISPATCH_PER_DESTINATION = 3;
// Round 3 (A9, owner decision): a DNS deadline is not the receiver's answer. The deadline stops waiting but can't cancel
// getaddrinfo, so one merchant's hanging DNS can make other merchants' lookups wait in Node's small threadpool and time
// out too. Such an attempt is deferred (lease released, attempts unchanged, retried later with an age-based backoff)
// instead of counted, for DNS_DEFER_WINDOW_MS after the delivery was queued; after that it counts like any failure, so
// a permanently broken host still ends in "failed" and can't be deferred forever. Engineering values, testnet.
const DNS_DEFER_WINDOW_MS = 2 * 60 * 60_000;
const DNS_DEFER_MIN_MS = 60_000;
const DNS_DEFER_MAX_MS = 15 * 60_000;

/** The lookup ran out of time (not "no such host"): see DNS_DEFER_WINDOW_MS. */
export class DnsTimeoutError extends HttpError {
  constructor() {
    super(400, "That host's DNS didn't answer in time. Try again in a moment.");
  }
}
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
  await vetAddresses(url);
}

/** Every address the URL's host resolves to (A and AAAA), after the SSRF checks: 400 unless all are public.
 *  DnsTimeoutError when the resolver doesn't answer within DNS_TIMEOUT_MS (the lookup is then cancelled). */
async function vetAddresses(url: string): Promise<string[]> {
  const host = new URL(url).hostname.replace(/^\[(.*)\]$/, "$1").replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new HttpError(400, NOT_PUBLIC);
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new DnsTimeoutError();
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort(); // round 4 (A11): the c-ares resolver cancels its queries; nothing is left running
          reject(timedOut);
        }, DNS_TIMEOUT_MS);
      });
      addresses = await Promise.race([net.resolve(host, abort.signal), deadline]);
    } catch (err) {
      if (err === timedOut || err instanceof DnsTimeoutError) throw timedOut;
      throw new HttpError(400, "We couldn't find that host. Check the URL.");
    } finally {
      clearTimeout(timer);
    }
  }
  if (addresses.length === 0 || addresses.some(isBlocked)) throw new HttpError(400, NOT_PUBLIC);
  return addresses;
}

/** Batch 031 round 4 (A11): how webhooks reach the network, injectable for tests (test/gw-helpers.mjs routes it through
 *  each test's dns.lookup and fetch mocks). Production: c-ares DNS with a real per-attempt deadline (no getaddrinfo, so
 *  one destination's hanging DNS can't occupy Node's shared threadpool and stall other destinations), and a POST pinned
 *  to the vetted address. */
export interface WebhookNet {
  /** Every A and AAAA address of `host`. Rejects (DnsTimeoutError on timeout/cancel) if there is none. */
  resolve(host: string, signal: AbortSignal): Promise<string[]>;
  /** One POST to `url` that connects ONLY to `address` (TLS SNI and Host stay the URL's hostname); the HTTP status.
   *  Never follows a redirect; rejects on no answer within `timeoutMs`. */
  post(url: string, address: string, headers: Record<string, string>, body: string, timeoutMs: number): Promise<number>;
}

async function caresResolve(host: string, signal: AbortSignal): Promise<string[]> {
  const resolver = new dns.Resolver({ timeout: 1_000, tries: 2 }); // one per attempt: cancel() only touches this lookup
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    // Review F1: one family that never answers (a broken AAAA, say) must not discard the other's answer. Once either
    // family has addresses, the other gets FAMILY_GRACE_MS, then is cancelled; only vetted addresses are ever used.
    const got: string[][] = [[], []];
    const codes: (string | undefined)[] = [undefined, undefined];
    const track = (p: Promise<string[]>, i: number) =>
      p.then(
        (v) => void (got[i] = v),
        (e: unknown) => void (codes[i] = (e as { code?: string })?.code ?? "error"),
      );
    const families = [track(resolver.resolve4(host), 0), track(resolver.resolve6(host), 1)];
    const both = Promise.all(families);
    await Promise.race(families);
    if (got[0].length > 0 || got[1].length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([both, new Promise<void>((r) => (timer = setTimeout(r, FAMILY_GRACE_MS)))]);
      clearTimeout(timer);
      resolver.cancel(); // stop a family still outstanding (no-op when both answered)
    } else {
      await both;
    }
    const addresses = [...got[0], ...got[1]];
    if (addresses.length > 0) return addresses;
    if (signal.aborted || codes.some((c) => c === "ETIMEOUT" || c === "ECANCELLED")) throw new DnsTimeoutError();
    throw new Error("no address");
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** `tls.ca` is for the controlled local HTTPS fixture in tests only (an extra trusted CA for that one request); production
 *  never passes it, so the system trust store and full hostname verification apply. TLS verification is never disabled. */
export function pinnedPost(url: string, address: string, headers: Record<string, string>, body: string, timeoutMs: number, tls: { ca?: string } = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const family = isIP(address);
    const hostname = u.hostname.replace(/^\[(.*)\]$/, "$1");
    const req = https.request(
      {
        hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        servername: isIP(hostname) ? undefined : hostname,
        agent: false, // a fresh connection per attempt: never reuse a socket that went somewhere else
        ...(tls.ca !== undefined && { ca: tls.ca }),
        // the vetted address, whatever DNS says now (no rebinding window); Node may ask for all addresses or one
        lookup: ((_host: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) =>
          options?.all ? callback(null, [{ address, family }]) : callback(null, address, family)) as never,
      },
      (res) => {
        resolve(res.statusCode ?? 0);
        res.destroy(); // the answer is never read or logged, only its status
      },
    );
    const timer = setTimeout(() => req.destroy(new Error("timeout")), timeoutMs);
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    req.on("close", () => clearTimeout(timer));
    req.end(body);
  });
}

export const defaultWebhookNet: WebhookNet = { resolve: caresResolve, post: (url, address, headers, body, timeoutMs) => pinnedPost(url, address, headers, body, timeoutMs) };
let net: WebhookNet = defaultWebhookNet;
/** Tests only: route DNS and HTTP through `n`; undefined restores the production implementation. */
export function setWebhookNet(n: WebhookNet | undefined): void {
  net = n ?? defaultWebhookNet;
}

const iso = (ms: number | string) => new Date(Number(ms)).toISOString();

type DeliveryRow = { id: string; webhook_id: string; event: string; status: string; attempts: number; next_attempt_at: string | null; response_status: number | null; created_at: string };
const DELIVERY_COLUMNS = "id, webhook_id, event, status, attempts, next_attempt_at::text, response_status, created_at::text";

// Batch 031 A13: the concurrency-critical statements, exported so the real-Postgres harness (apps/web/test-pg, independent
// connections) runs exactly the SQL that ships. Times are BIGINT unix ms. Parameters are listed per statement.
/** Claim a delivery's lease. $1 id, $2 leased_until (now + lease), $3 now. A live lease blocks: one winner. */
export const SQL_CLAIM_LEASE = "UPDATE app_gw_deliveries SET leased_until = $2 WHERE id = $1 AND (leased_until IS NULL OR leased_until <= $3) RETURNING id";
/** The inline first attempt's claim (round 2, L2): as SQL_CLAIM_LEASE, and only if nobody has tried it yet. */
export const SQL_CLAIM_FIRST_ATTEMPT =
  "UPDATE app_gw_deliveries SET leased_until = $2 WHERE id = $1 AND (leased_until IS NULL OR leased_until <= $3) AND status = 'pending' AND attempts = 0 RETURNING id";
/** Fenced outcome. $1 id, $2 attempts, $3 status, $4 next_attempt_at, $5 response_status, $6 our leased_until. 0 rows = our lease was taken over. */
export const SQL_OUTCOME = `UPDATE app_gw_deliveries SET attempts = $2, status = $3, next_attempt_at = $4, response_status = $5, leased_until = NULL
     WHERE id = $1 AND leased_until = $6 RETURNING ${DELIVERY_COLUMNS}`;
/** Fenced DNS-timeout deferral (round 3, A9). $1 id, $2 next_attempt_at, $3 our leased_until. */
export const SQL_DEFER = `UPDATE app_gw_deliveries SET next_attempt_at = $2, leased_until = NULL WHERE id = $1 AND leased_until = $3 RETURNING ${DELIVERY_COLUMNS}`;
/** Marker + one pending delivery per endpoint in ONE statement (A1). $1 key, $2 now, $3 event id, $4 type, $5 body,
 *  $6 next_attempt_at (now + lease), $7 merchant (lowercase). Returns the new delivery ids (none if the key existed). */
export const SQL_ENQUEUE_ONCE = `WITH fresh AS (
       INSERT INTO app_gw_events (key, created_at) VALUES ($1, $2::bigint) ON CONFLICT (key) DO NOTHING RETURNING key
     ), queued AS (
       INSERT INTO app_gw_deliveries (id, webhook_id, merchant, event_id, event, body, status, next_attempt_at, created_at)
       SELECT 'dlv_' || substr(md5(w.id || ':' || $3::text), 1, 24), w.id, w.merchant, $3::text, $4, $5, 'pending', $6::bigint, $2::bigint
       FROM app_gw_webhooks w CROSS JOIN fresh WHERE w.merchant = $7
       ON CONFLICT (id) DO NOTHING
       RETURNING id
     )
     SELECT id FROM queued ORDER BY id`;
/** Fair dispatch claim (round 4, A11): due, unleased, pending deliveries, at most $4 per destination (webhook) per run,
 *  oldest first, at most $3 in all. $1 now, $2 leased_until, $3 limit, $4 per-destination cap. No SKIP LOCKED (not allowed
 *  with window functions): a row another dispatcher claimed meanwhile fails the outer re-check under READ COMMITTED. */
export const SQL_DISPATCH_CLAIM = `UPDATE app_gw_deliveries SET leased_until = $2 WHERE id IN (
       SELECT id FROM (
         SELECT id, next_attempt_at, row_number() OVER (PARTITION BY webhook_id ORDER BY next_attempt_at, id) AS rn
         FROM app_gw_deliveries
         WHERE status = 'pending' AND next_attempt_at <= $1 AND (leased_until IS NULL OR leased_until <= $1)
       ) due WHERE rn <= $4 ORDER BY next_attempt_at, id LIMIT $3
     ) AND status = 'pending' AND next_attempt_at <= $1 AND (leased_until IS NULL OR leased_until <= $1) RETURNING id`;
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
  dispatchSoon(); // the Developers screen: retries show up as the merchant watches (batch 025)
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

/** One POST; the HTTP status, null if it never got an answer (not public, network error, 5 s timeout), or "dns_timeout"
 *  if our own DNS lookup ran out of time before anything was sent (round 3, A9). */
async function send(url: string, secret: string, body: string, now: number): Promise<number | null | "dns_timeout"> {
  let address: string;
  try {
    [address] = await vetAddresses(url); // checked on every attempt, and the POST connects only to this address (A11)
  } catch (err) {
    return err instanceof DnsTimeoutError ? "dns_timeout" : null;
  }
  try {
    const headers = { "content-type": "application/json", [SIGNATURE_HEADER]: signWebhook(body, secret, Math.floor(now / 1000)) };
    return await net.post(url, address, headers, body, TIMEOUT_MS);
  } catch {
    return null; // recorded as a failed attempt; the error text can hold the merchant's URL, so it isn't logged
  }
}

/** Takes the delivery's lease (batch 031 A4): true if this caller may attempt it now. The inline attempt, dispatchDue and
 *  a manual replay all go through the same lease, so one delivery is never POSTed twice at once. */
async function claimLease(id: string, now: number, firstAttemptOnly = false): Promise<boolean> {
  // firstAttemptOnly (round 2, L2): the inline first attempt claims only a delivery nobody has tried yet, so an instance
  // that stalled past the lease window never re-sends what dispatch already delivered.
  const rows = await query(firstAttemptOnly ? SQL_CLAIM_FIRST_ATTEMPT : SQL_CLAIM_LEASE, [id, now + LEASE_MS, now]);
  return rows.length === 1;
}

/** One attempt of a delivery whose lease this caller holds (`lease` = the leased_until it set). Records the outcome and
 *  frees the lease: 2xx → succeeded; else retry at 1 m / 5 m / 30 m, failed after 4. A delivery that already succeeded
 *  stays succeeded whatever a later replay gets back (A5): it reached the merchant once, and receivers dedupe on the id. */
async function attemptLeased(id: string, now: number, lease: number): Promise<DeliveryJson | null> {
  const rows = await query<{ body: string; attempts: number; status: string; created_at: string; url: string; secret: string }>(
    "SELECT d.body, d.attempts, d.status, d.created_at::text AS created_at, w.url, w.secret FROM app_gw_deliveries d JOIN app_gw_webhooks w ON w.id = d.webhook_id WHERE d.id = $1",
    [id],
  );
  const d = rows[0];
  if (!d) return null;
  const outcome = await send(d.url, d.secret, d.body, now);
  const age = now - Number(d.created_at);
  if (outcome === "dns_timeout" && d.status !== "succeeded" && age < DNS_DEFER_WINDOW_MS) {
    // A9: deferred, not counted — nothing was sent; back off with the delivery's age (1 min … 15 min)
    const retryAt = now + Math.min(DNS_DEFER_MAX_MS, Math.max(DNS_DEFER_MIN_MS, Math.floor(age / 4)));
    const deferred = await query<DeliveryRow>(SQL_DEFER, [id, retryAt, lease]);
    if (deferred[0]) return deliveryJson(deferred[0]);
    const current = await query<DeliveryRow>(`SELECT ${DELIVERY_COLUMNS} FROM app_gw_deliveries WHERE id = $1`, [id]);
    return current[0] ? deliveryJson(current[0]) : null;
  }
  const status = outcome === "dns_timeout" ? null : outcome;
  const attempts = Number(d.attempts) + 1;
  const delivered = d.status === "succeeded" || (status !== null && status >= 200 && status < 300);
  const next = delivered || attempts > RETRY_DELAYS_MS.length ? null : now + RETRY_DELAYS_MS[attempts - 1];
  const state = delivered ? "succeeded" : next === null ? "failed" : "pending";
  // fenced on our own lease: if it expired and someone else took over, their outcome stands and ours is dropped
  const updated = await query<DeliveryRow>(SQL_OUTCOME, [id, attempts, state, next, status, lease]);
  if (updated[0]) return deliveryJson(updated[0]);
  const current = await query<DeliveryRow>(`SELECT ${DELIVERY_COLUMNS} FROM app_gw_deliveries WHERE id = $1`, [id]);
  return current[0] ? deliveryJson(current[0]) : null;
}

/** Sends one delivery now (taking its lease) and records the outcome; null if there is no such delivery.
 *  409 while another attempt holds the lease, so nothing is sent twice. */
export async function attemptDelivery(id: string, now = Date.now()): Promise<DeliveryJson | null> {
  if (!(await claimLease(id, now))) {
    const exists = await query("SELECT 1 FROM app_gw_deliveries WHERE id = $1", [id]);
    if (exists.length === 0) return null;
    throw new HttpError(409, "This delivery is being sent right now. Try again in a minute.");
  }
  return attemptLeased(id, now, now + LEASE_MS);
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
  return attemptInline(ids, now);
}

/** The first attempt of freshly recorded deliveries. The rows are already recorded: a delivery someone else already
 *  leased or tried is skipped (dispatch owns it), and an inline attempt that throws (a DB blip on its status UPDATE)
 *  leaves its delivery pending for dispatch instead of failing the enqueue, which would make the caller re-enqueue
 *  (claude-frontend F2). */
function attemptInline(ids: string[], now: number) {
  return Promise.all(
    ids.map(async (id) => {
      try {
        if (!(await claimLease(id, now, true))) return null; // already taken or tried elsewhere: dispatch owns it
        return await attemptLeased(id, now, now + LEASE_MS);
      } catch (err: unknown) {
        // the name only: a message can hold the merchant's URL (021 review L2)
        console.error(`webhook delivery ${id}: inline attempt failed (${err instanceof Error ? err.name : typeof err}), left for dispatch`);
        return null;
      }
    }),
  );
}

/** Records the event for every endpoint of the merchant and makes the first attempt inline. `eventId` (events.ts derives
 *  it from the event's key) stays the same across a retried enqueue, so receivers can dedupe on it. */
export async function enqueueEvent(merchant: Address | string, type: EventType, data: object, now = Date.now(), eventId?: string) {
  const endpoints = await query<Endpoint>("SELECT id, merchant FROM app_gw_webhooks WHERE merchant = $1", [merchant.toLowerCase()]);
  return deliver(endpoints, type, data, now, eventId);
}

/** Queues a payment event at most once per `onceKey` (lib/server/events.ts) and makes the first attempts inline.
 *  The dedupe key and one pending delivery per endpoint are written by ONE statement (batch 031 A1): either both exist
 *  or neither, so a crash can never leave a "sent" marker with nothing to send. Each delivery id is derived from
 *  (endpoint, event id), so the same event never gets two deliveries for one endpoint (A3). A delivery is due only after
 *  the lease window: if this process dies before its inline attempt, dispatchDue picks it up (A6). Returns the inline
 *  attempts' results ([] when the key was already queued or the merchant has no endpoints). */
export async function enqueueEventOnce(onceKey: string, merchant: Address | string, type: EventType, data: object, now: number, eventId: string) {
  const body = JSON.stringify({ id: eventId, type, created: Math.floor(now / 1000), data });
  const queued = await query<{ id: string }>(SQL_ENQUEUE_ONCE, [onceKey, now, eventId, type, body, now + LEASE_MS, merchant.toLowerCase()]);
  return attemptInline(queued.map((r) => r.id), now);
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

/** Attempts up to DISPATCH_LIMIT (30) pending deliveries that are due; returns how many. Each is claimed with the shared lease (the same
 *  one an inline attempt or a replay takes), so overlapping runs, instances and replays never send one twice. */
export async function dispatchDue(now = Date.now()): Promise<number> {
  const lease = now + LEASE_MS;
  const due = await query<{ id: string }>(SQL_DISPATCH_CLAIM, [now, lease, DISPATCH_LIMIT, DISPATCH_PER_DESTINATION]);
  // at most DISPATCH_CONCURRENCY at once (M1); one attempt's DB error is logged and never aborts the rest (round 2, L1),
  // so a cron run can't end mid-batch with POSTs sent and their outcomes unrecorded
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const id = due[next++].id;
      try {
        await attemptLeased(id, now, lease);
      } catch (err: unknown) {
        console.error(`webhook delivery ${id}: dispatch attempt failed (${err instanceof Error ? err.name : typeof err}), retried after its lease`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DISPATCH_CONCURRENCY, due.length) }, worker));
  return due.length;
}

const DISPATCH_EVERY_MS = 30_000;
let lastDispatchAt = Number.NEGATIVE_INFINITY;

/** Runs dispatchDue after this response (FR-GW-7 on Vercel Hobby, whose crons run daily: claude-frontend's deploy
 *  review). At most once per server instance per DISPATCH_EVERY_MS; dispatchDue's lease and SKIP LOCKED keep instances
 *  from sending twice. Outside a request (tests, scripts) after() throws and nothing runs. Never throws or slows the
 *  response (NFR-4); a failure logs its error's name only. True if a dispatch was scheduled. */
export function dispatchSoon(schedule: (task: () => Promise<void>) => void = after, now = Date.now()): boolean {
  if (now >= lastDispatchAt && now - lastDispatchAt < DISPATCH_EVERY_MS) return false;
  const task = async () => {
    try {
      await dispatchDue(now);
    } catch (err) {
      console.error(`webhook dispatch failed (${err instanceof Error ? err.name : typeof err})`);
    }
  };
  try {
    schedule(task);
  } catch {
    return false; // outside a request: no response to run after
  }
  lastDispatchAt = now;
  return true;
}
