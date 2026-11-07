// The typed WhiteFlow API client (batch 052): one Bearer key, timeouts, retries of a lost reply with the same
// Idempotency-Key, redirects refused (never re-send the key elsewhere), every reply size-capped and parsed against its
// schema (production review F3), and every error reduced to a plain reason with the key scrubbed. Its `fetch` is the
// network for testnet, or the in-process sandbox (src/sandbox/backend.ts).
import type { z } from "zod";
import {
  AccountSchema,
  ApiPaymentSchema,
  ApprovalSchema,
  CustomerSchema,
  FinalizeSchema,
  InvoiceSchema,
  LinkDetailSchema,
  LinkSchema,
  OperationSchema,
  ReceivablesSchema,
  ReminderSchema,
  ReportSchema,
  pageOf,
} from "./contract.ts";
import { untrusted } from "./safety.ts";

export const MAX_RESPONSE_BYTES = 1_000_000;

export interface ClientOptions {
  baseUrl: URL;
  apiKey: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** A failed call. `ambiguous`: the request may have been applied (no answer, a timeout, a 5xx or a malformed success
 *  on a write), so the caller must retry with the same Idempotency-Key, never a new one. `unsupported`: no such route. */
export class ApiError extends Error {
  readonly status: number;
  readonly ambiguous: boolean;
  readonly unsupported: boolean;
  readonly body: Record<string, unknown> | null;
  readonly expose = true; // the message is safe to show the model (already scrubbed)
  constructor(status: number, message: string, opts: { ambiguous?: boolean; unsupported?: boolean; body?: Record<string, unknown> | null } = {}) {
    super(message);
    this.status = status;
    this.ambiguous = opts.ambiguous ?? false;
    this.unsupported = opts.unsupported ?? false;
    this.body = opts.body ?? null;
  }
}

export interface Result<T> {
  data: T;
  replayed: boolean;
}

type Query = Record<string, string | number | undefined | null>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SANDBOX_HOST = "sandbox.whiteflow.invalid"; // .invalid never resolves (RFC 2606): the sandbox is in-process only

/** An origin: https, or http for localhost; no credentials, path, query or fragment. */
export function gatewayOrigin(text: string, name = "WHITEFLOW_BASE_URL"): URL {
  const url = URL.canParse(text) ? new URL(text) : null;
  const secure = url && (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)));
  if (!url || !secure || url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${name} must be an https origin, like https://whiteflow-app.vercel.app (http only for localhost).`);
  }
  return new URL(url.origin);
}
export const SANDBOX_ORIGIN = new URL(`https://${SANDBOX_HOST}`);

const backoff = (attempt: number) => 300 * 2 ** attempt + Math.floor(Math.random() * 100); // with jitter

/** The body as text, refusing more than `max` bytes without reading the rest (a backend can't flood the connector). */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export class WhiteflowClient {
  readonly #key: string;
  readonly #base: URL;
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: ClientOptions) {
    if (!/^[\x21-\x7e]{8,200}$/.test(opts.apiKey)) throw new Error("The API key has spaces, line breaks or other characters a key never has: copy it again.");
    this.#key = opts.apiKey;
    this.#base = opts.baseUrl;
    this.#fetch = opts.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 15_000;
    this.#maxRetries = opts.maxRetries ?? 2;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get origin(): URL {
    return this.#base;
  }

  account = () => this.#call(AccountSchema, "GET", "/api/v1/account");
  operation = (key: string) => this.#call(OperationSchema, "GET", `/api/v1/operations/${encodeURIComponent(key)}`);
  searchCustomers = (query: string, limit: number) => this.#call(pageOf(CustomerSchema, 50), "GET", "/api/v1/customers", { query: { query, limit } });
  createCustomer = (body: { name: string; email?: string; confirm_new?: boolean }, key: string) => this.#call(CustomerSchema, "POST", "/api/v1/customers", { body, key });
  createLink = (body: Record<string, unknown>, key: string) => this.#call(LinkSchema, "POST", "/api/v1/links", { body, key });
  getLink = (id: string) => this.#call(LinkDetailSchema, "GET", `/api/v1/links/${encodeURIComponent(id)}`);
  createInvoice = (body: Record<string, unknown>, key: string) => this.#call(InvoiceSchema, "POST", "/api/v1/invoices", { body, key });
  updateInvoice = (id: string, body: Record<string, unknown>, key: string) => this.#call(InvoiceSchema, "POST", `/api/v1/invoices/${encodeURIComponent(id)}`, { body, key });
  finalizeInvoice = (id: string, body: { revision: number }, key: string) => this.#call(FinalizeSchema, "POST", `/api/v1/invoices/${encodeURIComponent(id)}/finalize`, { body, key });
  getApproval = (id: string) => this.#call(ApprovalSchema, "GET", `/api/v1/approvals/${encodeURIComponent(id)}`);
  getInvoice = (ref: string) => this.#call(InvoiceSchema, "GET", `/api/v1/invoices/${encodeURIComponent(ref)}`);
  listInvoices = (query: Query) => this.#call(pageOf(InvoiceSchema, 100), "GET", "/api/v1/invoices", { query });
  reminderDraft = (id: string) => this.#call(ReminderSchema, "GET", `/api/v1/invoices/${encodeURIComponent(id)}/reminder-draft`);
  receivables = () => this.#call(ReceivablesSchema, "GET", "/api/v1/receivables");
  listPayments = (query: Query) => this.#call(pageOf(ApiPaymentSchema, 200), "GET", "/api/v1/payments", { query });
  report = (query: { from: string; to: string; tz: string }) => this.#call(ReportSchema, "GET", "/api/v1/reports", { query });

  async #call<S extends z.ZodTypeAny>(schema: S, method: "GET" | "POST", path: string, opts: { query?: Query; body?: unknown; key?: string } = {}): Promise<Result<z.infer<S>>> {
    const url = new URL(path, this.#base);
    for (const [name, value] of Object.entries(opts.query ?? {})) if (value !== undefined && value !== null && value !== "") url.searchParams.set(name, String(value));
    const headers: Record<string, string> = { authorization: `Bearer ${this.#key}`, accept: "application/json" };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (method === "POST") {
      if (!opts.key) throw new Error("internal: a write needs an Idempotency-Key"); // never retry a write without one
      headers["idempotency-key"] = opts.key;
    }
    const init: RequestInit = { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: "error" };
    const write = method === "POST";
    // once any attempt of a write went unanswered or failed on the server, it may have been applied: from then on only
    // a 2xx (the record) or a 422 (the key belongs to another request) is a definite answer (security review 052 M1)
    let uncertain = false;
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= this.#maxRetries;
      let res: Response;
      try {
        res = await this.#fetch(url, { ...init, signal: AbortSignal.timeout(this.#timeoutMs) });
      } catch (error) {
        uncertain = true;
        if (!last) {
          await this.#sleep(backoff(attempt));
          continue;
        }
        const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        throw new ApiError(0, this.#scrub(`${timedOut ? "WhiteFlow didn't answer in time" : "Couldn't reach WhiteFlow"} (${url.origin}).`), { ambiguous: write });
      }
      if ((res.status >= 500 || res.status === 429) && !last) {
        if (res.status >= 500) uncertain = true;
        const wait = Number(res.headers.get("retry-after"));
        await res.body?.cancel().catch(() => {});
        await this.#sleep(Number.isFinite(wait) && wait > 0 && wait <= 30 ? wait * 1000 : backoff(attempt));
        continue;
      }
      return this.#read(schema, res, write, write && uncertain);
    }
  }

  async #read<S extends z.ZodTypeAny>(schema: S, res: Response, write: boolean, uncertain = false): Promise<Result<z.infer<S>>> {
    const text = await readCapped(res, MAX_RESPONSE_BYTES).catch(() => "");
    if (text === null) {
      throw new ApiError(502, `WhiteFlow's reply was larger than ${MAX_RESPONSE_BYTES} bytes and was not read.${write ? " The write may or may not have happened." : ""}`, { ambiguous: write });
    }
    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = text ? JSON.parse(text) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
    } catch {
      json = null;
    }
    if (res.ok && json) {
      const parsed = schema.safeParse(json);
      if (parsed.success) return { data: parsed.data, replayed: res.headers.get("idempotent-replayed") === "true" };
      // a success we can't read is not a refusal: for a write it stays unresolved and is resumed with the same key
      throw new ApiError(502, `WhiteFlow's reply wasn't in the expected format.${write ? " The write may or may not have happened." : ""}`, { ambiguous: write });
    }
    // the backend's words reach the model: bounded and stripped like stored text (security review 052 L5)
    const said = typeof json?.error === "string" ? untrusted(json.error, 300) : null;
    // 429 and "still being processed" (409) say nothing about whether the write happened: keep the same key
    const pending = write && (res.status === 429 || (res.status === 409 && /still being processed/i.test(said ?? "")));
    if (write && !res.ok && res.status !== 422 && (uncertain || pending)) {
      throw new ApiError(res.status, `${said ? `${this.#scrub(said)} ` : ""}WhiteFlow may or may not have applied this write.`, { ambiguous: true, body: json });
    }
    switch (true) {
      case res.status === 401:
        throw new ApiError(401, "WhiteFlow didn't accept the API key: it's missing, revoked or expired. Create a new secret key (Developers screen) and update the connector's settings.");
      case res.status === 403:
        throw new ApiError(403, this.#scrub(said ?? "This API key isn't allowed to do that."), { body: json });
      case res.status === 404 && !json:
        throw new ApiError(404, "This WhiteFlow backend doesn't offer that yet.", { unsupported: true });
      case res.status === 429:
        throw new ApiError(429, "WhiteFlow is rate-limiting this key. Wait a minute, then try again.", { ambiguous: false });
      case res.status >= 500:
        throw new ApiError(res.status, `WhiteFlow had a problem (${res.status}).${write ? " The write may or may not have happened." : ""}`, { ambiguous: write });
      case res.ok:
        throw new ApiError(502, `WhiteFlow answered without a JSON body.${write ? " The write may or may not have happened." : ""}`, { ambiguous: write });
      default:
        throw new ApiError(res.status, this.#scrub(said ?? `WhiteFlow refused the request (${res.status}).`), { body: json });
    }
  }

  #scrub(text: string): string {
    return text.replaceAll(this.#key, "[redacted]");
  }
}
