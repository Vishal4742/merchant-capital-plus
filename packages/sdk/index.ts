// Merchant Capital+ gateway SDK (FR-GW-5): create a checkout, read it, list payments, verify a webhook.
// Server-only: it holds the shop's secret key. The pay button (FR-GW-4) is a separate browser file.
// No runtime dependencies: global fetch + node:crypto (Node 20+, Vercel's Node runtime).
import { createHmac, timingSafeEqual } from "node:crypto";

export type Currency = "USDT" | "USD" | "EUR" | "GBP" | "INR" | "AED" | "SGD";
export interface LineItem { name: string; qty: number; price: string }

export interface CreateSessionParams {
  /** Like "25.00" (up to 6 decimals), in `currency`. A number is sent as String(n). */
  amount: string | number;
  /** Default USDT. Any other currency is converted at a quote locked for the session (FR-GW-11). */
  currency?: Currency;
  /** Your order id; comes back as `reference` on the session, the payment and the webhook. */
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

export const SIGNATURE_HEADER = "MC-Signature";
const DEFAULT_TOLERANCE_SEC = 300;

const hmac = (secret: string, timestamp: number, rawBody: string | Uint8Array) =>
  createHmac("sha256", secret).update(`${timestamp}.`).update(rawBody).digest();

/** The MC-Signature header for a webhook body: `t=<unix s>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. */
export function signWebhook(rawBody: string | Uint8Array, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmac(secret, timestamp, rawBody).toString("hex")}`;
}

/** Checks the MC-Signature header against the raw body (not re-serialized JSON) and returns the event.
 *  Throws WebhookSignatureError: answer 400 and don't act on the body. */
export function constructEvent(rawBody: string | Uint8Array, header: string | null | undefined, secret: string, opts: { toleranceSec?: number } = {}): GatewayEvent {
  if (!secret) throw new WebhookSignatureError("No webhook secret configured.");
  const parts = new Map((header ?? "").split(",").map((part) => part.trim().split("=", 2) as [string, string]));
  const t = parts.get("t") ?? "", v1 = parts.get("v1") ?? "";
  if (!/^\d{1,12}$/.test(t) || !/^[0-9a-f]{64}$/.test(v1)) throw new WebhookSignatureError(`Missing or malformed ${SIGNATURE_HEADER} header.`);
  const timestamp = Number(t);
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > (opts.toleranceSec ?? DEFAULT_TOLERANCE_SEC)) {
    throw new WebhookSignatureError("Webhook timestamp is outside the tolerance window (possible replay).");
  }
  if (!timingSafeEqual(hmac(secret, timestamp, rawBody), Buffer.from(v1, "hex"))) throw new WebhookSignatureError("Webhook signature doesn't match.");
  const text = typeof rawBody === "string" ? rawBody : new TextDecoder().decode(rawBody);
  return JSON.parse(text) as GatewayEvent;
}

export interface GatewayOptions {
  /** The gateway's origin, like https://merchant-capital.vercel.app */
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  /** Retries for network errors and 5xx answers (never for 4xx). Default 2. */
  maxRetries?: number;
}

export class Gateway {
  readonly #key: string;
  readonly #base: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;

  constructor(secretKey: string, opts: GatewayOptions) {
    if ("window" in globalThis) throw new Error("Gateway uses your secret key: create it on your server, never in the browser.");
    if (!secretKey) throw new Error("Gateway needs your secret key.");
    if (secretKey.startsWith("pk_")) throw new Error("That's a publishable key (pk_): Gateway needs the secret key. Use pk_ keys only in the pay button.");
    if (!URL.canParse(opts?.baseUrl ?? "")) throw new Error("Gateway needs baseUrl, the gateway's origin, like https://merchant-capital.vercel.app");
    this.#key = secretKey;
    this.#base = new URL(opts.baseUrl);
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
    this.#maxRetries = opts.maxRetries ?? 2;
  }

  readonly sessions = {
    create: async (params: CreateSessionParams, opts: { idempotencyKey?: string } = {}): Promise<CreatedSession> => {
      const { orderId, amount, ...rest } = params;
      const session = await this.#call<CreatedSession>("POST", "/api/v1/sessions", { ...rest, amount: String(amount), reference: orderId }, opts.idempotencyKey);
      // A gateway without FR-GW-11 ignores `currency` and would charge 25 EUR as 25 USDT.
      if ((params.currency ?? "USDT") !== "USDT" && session.currency !== params.currency) {
        throw new GatewayError(200, `This gateway doesn't price in ${params.currency} yet; checkout ${session.id} was created in USDT. Don't send the customer to it.`);
      }
      return session;
    },
    retrieve: (id: string): Promise<Session> => this.#call<Session>("GET", `/api/v1/sessions/${encodeURIComponent(id)}`),
  };

  readonly payments = {
    list: (params: { limit?: number; cursor?: string } = {}): Promise<{ data: Payment[]; next: string | null }> => {
      const query = new URLSearchParams();
      if (params.limit !== undefined) query.set("limit", String(params.limit));
      if (params.cursor !== undefined) query.set("cursor", params.cursor);
      const qs = query.toString();
      return this.#call("GET", `/api/v1/payments${qs ? `?${qs}` : ""}`);
    },
  };

  readonly webhooks = { constructEvent, sign: signWebhook };

  async #call<T>(method: "GET" | "POST", path: string, body?: object, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#key}` };
    if (body) headers["content-type"] = "application/json";
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const init = { method, headers, body: body ? JSON.stringify(body) : undefined };
    // ponytail: the sessions API has no idempotency yet, so a retried POST can leave an extra unpaid session
    // (it expires in 30 min; no money moves). Harmless; the key is sent for when the server dedupes.
    for (let attempt = 0; ; attempt++) {
      const retry = attempt < this.#maxRetries;
      let res: Response;
      try {
        res = await this.#fetch(new URL(path, this.#base), { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
      } catch (err) {
        if (retry) { await backoff(attempt); continue; }
        throw new GatewayError(0, `Couldn't reach the gateway: ${(err as Error).message}`);
      }
      if (res.status >= 500 && retry) { await backoff(attempt); continue; }
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok || !json || typeof json !== "object") {
        throw new GatewayError(res.status, typeof json?.error === "string" ? json.error : `The gateway answered ${res.status} without a JSON body.`);
      }
      return json as T;
    }
  }
}

const backoff = (attempt: number) => new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
