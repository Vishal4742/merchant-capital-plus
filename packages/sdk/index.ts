// Merchant Capital+ gateway SDK (FR-GW-5): create a checkout, read it, list payments, verify a webhook.
// Server-only: it holds the shop's secret key. The pay button (FR-GW-4) is a separate browser file.
// No runtime dependencies: global fetch + node:crypto (Node 20+, Vercel's Node runtime).
import { createHmac, timingSafeEqual } from "node:crypto";

export type Currency = "USDT" | "USD" | "EUR" | "GBP" | "INR" | "AED" | "SGD";
export interface LineItem { name: string; qty: number; price: string }

export interface CreateSessionParams {
  /** Like "25.00" (up to 6 decimals), in `currency`. A number is sent as String(n); prefer strings. */
  amount: string | number;
  /** Default USDT. Any other currency is converted at a quote locked for the session (FR-GW-11). */
  currency?: Currency;
  /** Your order id, 1-40 characters. It comes back as `reference` on the session, the payment and the webhook. */
  orderId?: string;
  items?: LineItem[];
  /** Where the checkout's "Back to shop" link goes (http/https). */
  returnUrl?: string;
}

/** What `sessions.create` returns: send the customer to `url`. */
export interface CreatedSession {
  id: string;
  url: string;
  /** USDT the customer pays. */
  amount: string;
  currency: Currency;
  /** The locked FX quote; present when you priced in a currency other than USDT. */
  priced?: { currency: Currency; amount: string; rate: string; rateAt: string; source: string };
  expiresAt: string;
}

/** What `sessions.retrieve` returns. Count an order as paid only when `status` is "paid". */
export interface Session {
  id: string;
  status: "open" | "pending" | "paid" | "expired";
  amount: string;
  currency: Currency;
  reference: string;
  paymentId: string | null;
  txHash: string | null;
  refunded?: string;
}

export interface Payment {
  paymentId: string;
  sessionId: string | null;
  invoiceId: string | null;
  amount: string;
  refunded: string;
  txHash: string;
  paidAt: string;
  reference: string;
}

export interface GatewayEvent {
  id: string;
  type: "payment.succeeded" | "payment.refunded";
  created: number;
  data: Session & { link_id?: string | null; page_id?: string | null };
}

export class GatewayError extends Error {
  /** HTTP status; 0 when the gateway couldn't be reached. */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
  }
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookSignatureError";
  }
}

/** True when two USDT amount strings are the same money: "1,000.00", "1000.00" and "1000" all match.
 *  Compare amounts with this, never with ===: API and webhook amounts may be formatted differently. */
export function sameAmount(a: string, b: string): boolean {
  const units = (s: string) => {
    const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(s).replaceAll(",", "").trim());
    return m ? BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0")) : null;
  };
  const x = units(a);
  return x !== null && x === units(b);
}

export const SIGNATURE_HEADER = "MC-Signature";
const DEFAULT_TOLERANCE_SEC = 300;

const hmac = (secret: string, timestamp: number, rawBody: string | Uint8Array) =>
  createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();

/** The MC-Signature header for a webhook body: `t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. */
export function signWebhook(rawBody: string | Uint8Array, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  if (!secret) throw new Error("signWebhook needs the endpoint's webhook secret.");
  return `t=${timestamp},v1=${hmac(secret, timestamp, rawBody).toString("hex")}`;
}

/** Checks the MC-Signature header against the raw body (not re-serialized JSON) and returns the event.
 *  Throws WebhookSignatureError for a bad or old signature (answer 400, don't act on the body), and a plain
 *  Error for a config mistake (no secret, bad toleranceSec), which should surface as a 500. */
export function constructEvent(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, opts: { toleranceSec?: number } = {}): GatewayEvent {
  // Config mistakes are the shop's bug, not a bad request: plain Errors, so the handler answers 500 and someone notices.
  if (!secret) throw new Error("No webhook secret configured: set the signing secret shown for your endpoint.");
  const tolerance = opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("toleranceSec must be a finite number of seconds, 0 or more.");
  const parts = new Map((header ?? "").split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  const t = parts.get("t") ?? "", v1 = parts.get("v1") ?? "";
  if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(v1)) throw new WebhookSignatureError(`Missing or malformed ${SIGNATURE_HEADER} header.`);
  const timestamp = Number(t);
  if (!(Math.abs(Math.floor(Date.now() / 1000) - timestamp) <= tolerance)) {
    throw new WebhookSignatureError("Webhook timestamp is outside the tolerance window (possible replay).");
  }
  if (!timingSafeEqual(hmac(secret, timestamp, rawBody), Buffer.from(v1, "hex"))) {
    throw new WebhookSignatureError("Webhook signature doesn't match: check the secret, and pass the raw body, not re-serialized JSON.");
  }
  const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  return JSON.parse(text) as GatewayEvent;
}

export interface GatewayOptions {
  /** The gateway's https origin, like https://whiteflow-app.vercel.app (http only for localhost). */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Retries for network errors and 5xx answers (never for 4xx). Default 2. */
  maxRetries?: number;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class Gateway {
  readonly #key: string;
  readonly #base: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;

  constructor(secretKey: string, opts: GatewayOptions) {
    if ("window" in globalThis) throw new Error("Gateway uses your secret key: create it on your server, never in the browser.");
    if (!secretKey) throw new Error("Gateway needs your secret key.");
    if (secretKey.startsWith("pk_")) throw new Error("That's a publishable key (pk_): Gateway needs the secret key, and only on your server.");
    // Printable ASCII only: a pasted key with a newline would otherwise land, in full, in fetch's error text.
    if (!/^[\x21-\x7e]+$/.test(secretKey)) throw new Error("That secret key has spaces, line breaks or other characters a key never has: copy it again.");
    const base = URL.canParse(opts?.baseUrl ?? "") ? new URL(opts.baseUrl) : undefined;
    const secure = base && (base.protocol === "https:" || (base.protocol === "http:" && LOCAL_HOSTS.has(base.hostname)));
    // No user:pass (it would leak into fetch errors) and no ?query or #hash (they break the path join).
    if (!base || !secure || base.username || base.password || base.search || base.hash) {
      throw new Error("Gateway needs baseUrl, the gateway's https origin, like https://whiteflow-app.vercel.app (http only for localhost; no user:pass, ?query or #hash).");
    }
    this.#key = secretKey;
    // origin + path only (a bare "?" or "#" leaves no search/hash but would break the join); keeps a path prefix.
    this.#base = new URL(`${base.origin}${base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`}`);
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
    this.#maxRetries = opts.maxRetries ?? 2;
  }

  readonly sessions = {
    create: async (params: CreateSessionParams, opts: { idempotencyKey?: string } = {}): Promise<CreatedSession> => {
      const { orderId, amount, ...rest } = params;
      // The server trims and cuts reference to 40 characters; two orders could then share one reference.
      if (orderId !== undefined && (typeof orderId !== "string" || !/^\S(.{0,38}\S)?$/.test(orderId))) {
        throw new GatewayError(400, "orderId must be 1-40 characters with no spaces at either end: it comes back as the payment's reference.");
      }
      const session = await this.#call<CreatedSession>("POST", "api/v1/sessions", { ...rest, amount: String(amount), reference: orderId }, opts.idempotencyKey);
      // A gateway without FR-GW-11 ignores `currency` and would charge 25 EUR as 25 USDT; the quote is the proof.
      const want = params.currency ?? "USDT", got = session.priced?.currency ?? "USDT";
      if (got !== want) {
        throw new GatewayError(200, this.#scrub(`Checkout ${session.id} came back priced in ${got}, not ${want}: don't send the customer to it. This gateway may not support ${want} yet; price in USDT.`));
      }
      return session;
    },
    retrieve: async (id: string): Promise<Session> => {
      if (!/^[\w-]{1,64}$/.test(id)) throw new GatewayError(400, "That isn't a checkout session id.");
      return this.#call<Session>("GET", `api/v1/sessions/${id}`);
    },
  };

  readonly payments = {
    list: (params: { limit?: number; cursor?: string } = {}): Promise<{ data: Payment[]; next: string | null }> => {
      const query = new URLSearchParams();
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.cursor !== undefined) query.set("cursor", params.cursor);
      const qs = query.toString();
      return this.#call("GET", `api/v1/payments${qs ? `?${qs}` : ""}`);
    },
  };

  readonly webhooks = { constructEvent };

  async #call<T>(method: "GET" | "POST", path: string, body?: object, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#key}` };
    if (body) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    // redirect "error": never re-send the key to wherever a redirect points; use the final URL as baseUrl.
    const init = { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "error" as const };
    // ponytail: the sessions API has no idempotency yet, so a retried POST can leave an extra unpaid session
    // (it expires in 30 min; no money moves). Harmless; the key is sent for when the server dedupes.
    for (let attempt = 0; ; attempt++) {
      const retry = attempt < this.#maxRetries;
      let res: Response;
      try {
        res = await this.#fetch(new URL(path, this.#base), { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
      } catch (err) {
        if (retry) { await backoff(attempt); continue; }
        throw new GatewayError(0, this.#scrub(`Couldn't reach the gateway: ${(err as Error)?.message ?? err}`));
      }
      if (res.status >= 500 && retry) {
        await res.body?.cancel().catch(() => {}); // free the connection before retrying
        await backoff(attempt);
        continue;
      }
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok || !json || typeof json !== "object") {
        const said = typeof json?.error === "string" ? json.error : `The gateway answered ${res.status} without a JSON body.`;
        const hint = res.status === 401 ? " Check GATEWAY_SECRET_KEY and that baseUrl is the right gateway." : "";
        throw new GatewayError(res.status, this.#scrub(said + hint));
      }
      return json as T;
    }
  }

  /** Every error message passes here, so the key never reaches a shop's logs, whoever echoed it. */
  #scrub(text: string): string {
    return text.replaceAll(this.#key, "[secret key]");
  }
}

const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
