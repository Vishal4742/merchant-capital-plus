// A typed client for the gateway's API keys and webhooks routes (claude-contracts, batch 007 API.md; SRS FR-GW-6,
// FR-GW-7), for the Developers screen in the browser (same origin: the sign-in cookie goes along). Every answer is
// checked against the contract, and every failure becomes one plain sentence. Field names stay snake_case, as on the wire.
// A new key and a new endpoint's signing secret come back from create only: nothing here keeps, logs or puts them in a URL.
import { GatewayError, type Transport } from "./gateway-client.ts";

export type KeyKind = "pk" | "sk";
export const MAX_LABEL = 40;
export const MAX_ENDPOINTS = 5; // the gateway's limit per merchant (lib/server/webhooks.ts)
const MAX_URL = 500;

export interface ApiKey {
  id: string;
  label: string;
  kind: KeyKind;
  prefix: string; // the key's first 12 characters, e.g. "sk_test_Q3vX"
  created_at: string;
  last_used_at: string | null;
}
export interface NewKey extends ApiKey {
  key: string; // shown once
}
export const DELIVERY_STATUSES = ["pending", "succeeded", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
export interface Delivery {
  id: string;
  event: string;
  status: DeliveryStatus;
  attempts: number;
  next_attempt_at: string | null;
  response_status: number | null;
  at: string;
}
export interface Webhook {
  id: string;
  url: string;
  created_at: string;
  deliveries: Delivery[];
}
export interface NewWebhook {
  id: string;
  url: string;
  secret: string; // shown once
  created_at: string;
}

/** The pill on each delivery. */
export const DELIVERY_LABEL: Record<DeliveryStatus, string> = { pending: "Pending", succeeded: "Delivered", failed: "Failed" };

/** The "next try" line for a delivery, given its next attempt already written out (or null). */
export const nextTryText = (d: Pick<Delivery, "status" | "next_attempt_at">, nextText: string | null) =>
  d.status === "pending" && nextText ? `Next try ${nextText}` : d.status === "failed" ? "No more tries" : null;

/** What's wrong with an endpoint URL before it is sent (the gateway also checks it's a public address), or null. */
export function httpsProblem(raw: string): string | null {
  const text = raw.trim();
  if (!text) return "Enter your endpoint's URL.";
  if (text.length > MAX_URL) return `That URL is too long (${MAX_URL} characters at most).`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "Enter the full URL, starting with https://.";
  }
  if (url.protocol !== "https:") return "Use an https:// URL. We only send events over https.";
  if (url.username || url.password) return "Leave the user name and password out of the URL.";
  return null;
}

// ── parsing: the contract's shapes or nothing ──
const UNREADABLE = "The gateway sent an answer we couldn't read. Try again in a minute.";
const bad = (): never => {
  throw new GatewayError(502, UNREADABLE);
};
const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : bad());
const text = (v: unknown) => (typeof v === "string" ? v : bad());
const time = (v: unknown) => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : bad());
const nullable = <T>(v: unknown, read: (v: unknown) => T): T | null => (v === null || v === undefined ? null : read(v));
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad());
const httpStatus = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 100 && v <= 599 ? v : bad());
const kind = (v: unknown) => (v === "pk" || v === "sk" ? v : bad());
const deliveryStatus = (v: unknown) => ((DELIVERY_STATUSES as readonly unknown[]).includes(v) ? (v as DeliveryStatus) : bad());
function https(v: unknown): string {
  try {
    if (new URL(text(v)).protocol === "https:") return v as string;
  } catch {}
  return bad();
}

/** A key row: known fields only, so a `key` in a list answer never reaches the screen. */
export function keyOf(v: unknown): ApiKey {
  const r = record(v);
  const k = kind(r.kind);
  const prefix = text(r.prefix);
  if (!prefix.startsWith(`${k}_test_`)) bad();
  return { id: text(r.id), label: text(r.label), kind: k, prefix, created_at: time(r.created_at), last_used_at: nullable(r.last_used_at, time) };
}
function newKeyOf(v: unknown): NewKey {
  const row = keyOf(v);
  const key = text(record(v).key);
  return key.startsWith(row.prefix) && /^(pk|sk)_test_[A-Za-z0-9_-]{32}$/.test(key) ? { ...row, key } : bad();
}
export function deliveryOf(v: unknown): Delivery {
  const r = record(v);
  return {
    id: text(r.id),
    event: text(r.event),
    status: deliveryStatus(r.status),
    attempts: count(r.attempts),
    next_attempt_at: nullable(r.next_attempt_at, time),
    response_status: nullable(r.response_status, httpStatus),
    at: time(r.at),
  };
}
/** An endpoint row: known fields only, so its signing secret never reaches the screen after create. */
export function webhookOf(v: unknown): Webhook {
  const r = record(v);
  if (!Array.isArray(r.deliveries)) bad();
  return { id: text(r.id), url: https(r.url), created_at: time(r.created_at), deliveries: (r.deliveries as unknown[]).map(deliveryOf) };
}
function newWebhookOf(v: unknown): NewWebhook {
  const r = record(v);
  const secret = text(r.secret);
  return /^whsec_[A-Za-z0-9_-]{16,}$/.test(secret) ? { id: text(r.id), url: https(r.url), secret, created_at: time(r.created_at) } : bad();
}

// ── calls ──
const OFFLINE = "We couldn't reach the gateway. Check your connection and try again.";
const MAX_MESSAGE = 300;
const TIMEOUT_MS = 10_000;
const KEYS = "API keys";
const HOOKS = "Webhooks";

/** One sentence for a failed answer (spec 011: 404 → not on this server, 401 → sign in, 429 → wait). */
function plainError(status: number, data: unknown, what: string): GatewayError {
  if (status === 401) return new GatewayError(401, "Your sign-in has ended. Sign in again.");
  if (status === 429) return new GatewayError(429, "Too many tries. Wait a minute and try again.");
  const said = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error.slice(0, MAX_MESSAGE) : null;
  if (said) return new GatewayError(status, said); // the gateway's errors are plain sentences by contract
  if (status === 404) return new GatewayError(503, `${what} aren't available on this server yet.`); // Next's 404 page: no route here
  if (status >= 500) return new GatewayError(status, "The gateway had a problem. Nothing was changed; try again in a minute.");
  return new GatewayError(status, "That didn't work. Check the details and try again.");
}

/** True when the sign-in cookie has ended: the screen reloads into sign-in. */
export const signedOut = (error: unknown) => error instanceof GatewayError && error.status === 401;

export function devClient({ fetch: send = fetch }: Transport = {}) {
  async function call(method: "POST" | "DELETE", path: string, what: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await send(path, {
        method,
        headers: { accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new GatewayError(0, OFFLINE); // never the transport's own text: it can name hosts and addresses
    }
    const data: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw plainError(res.status, data, what);
    return data;
  }
  const id = encodeURIComponent;
  return {
    createKey: async (label: string, kind: KeyKind) => newKeyOf(await call("POST", "/api/v1/keys", KEYS, { label, kind })),
    revokeKey: async (keyId: string) => void (await call("DELETE", `/api/v1/keys/${id(keyId)}`, KEYS)),
    addWebhook: async (url: string) => newWebhookOf(await call("POST", "/api/v1/webhooks", HOOKS, { url })),
    deleteWebhook: async (hookId: string) => void (await call("DELETE", `/api/v1/webhooks/${id(hookId)}`, HOOKS)),
    sendTest: async (hookId: string) => deliveryOf(await call("POST", `/api/v1/webhooks/${id(hookId)}/test`, HOOKS, {})),
    resend: async (deliveryId: string) => deliveryOf(await call("POST", `/api/v1/webhooks/deliveries/${id(deliveryId)}/replay`, HOOKS, {})),
  };
}
