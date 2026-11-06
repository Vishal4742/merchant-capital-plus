// A typed client for the gateway's links and pages routes (claude-contracts, batch 007 API.md; SRS FR-GW-1, FR-GW-2).
// Used in the browser (same origin: the sign-in cookie goes along); our server reads lib/server directly
// (lib/gateway-server.ts) and narrows its JSON with the parsers here. Every answer is checked against the contract
// before use, since it comes from another lane, and every failure becomes one plain sentence. Field names stay
// snake_case, as on the wire.

export const PRICE_CURRENCIES = ["USD", "EUR", "GBP", "INR", "AED", "SGD"] as const; // what a merchant prices in (FR-GW-11)
export type Currency = "USDT" | (typeof PRICE_CURRENCIES)[number];
const CURRENCIES: readonly string[] = ["USDT", ...PRICE_CURRENCIES]; // the API also takes USDT
export const LINK_STATUSES = ["active", "paid", "expired", "cancelled"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];
/** Public link and page slugs (the gateway makes 10 base62 characters). */
export const SLUG = /^[0-9A-Za-z]{1,64}$/;

export interface Link {
  id: string;
  slug: string;
  amount: string | null; // a plain decimal in `currency`; null: the customer enters it
  currency: Currency;
  description: string;
  reference_id: string | null;
  single_use: boolean;
  status: LinkStatus;
  expires_at: string | null;
  created_at: string;
  payments: number;
}
export interface PageItem {
  name: string;
  price: string;
}
export interface OpenAmount {
  min: string | null;
  max: string | null;
}
export interface PageFields {
  title: string;
  description: string | null;
  logo_url: string | null; // https only
  color: string | null; // #RRGGBB
  currency: Currency;
  items: PageItem[] | null; // null: an open-amount page
  open_amount: OpenAmount | null;
}
export interface Page extends PageFields {
  id: string;
  slug: string;
  created_at: string;
  payments: number;
}
export interface PublicLink {
  slug: string;
  merchant_name: string;
  amount: string | null;
  currency: Currency;
  description: string;
  status: LinkStatus;
}
export interface PublicPage extends PageFields {
  slug: string;
  merchant_name: string;
}

export interface LinkBody {
  amount: string | null;
  currency: Currency;
  description: string;
  expires_at?: string;
  single_use: boolean;
}
export interface PageBody {
  title: string;
  description?: string;
  logo_url?: string;
  color?: string;
  currency: Currency;
  items?: PageItem[];
  open_amount?: { min?: string; max?: string };
}
export type CheckoutBody = { amount?: string } | { items: { name: string; qty: number }[] };

/** A failed call. `status` 0: no answer at all; 503 also covers a route this server doesn't have yet. */
export class GatewayError extends Error {
  readonly status: number; // a plain field: Node's type stripping can't run TS parameter properties
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const UNREADABLE = "The gateway sent an answer we couldn't read. Try again in a minute.";
const OFFLINE = "We couldn't reach the gateway. Check your connection and try again.";
const MAX_MESSAGE = 300;
const TIMEOUT_MS = 10_000;

// ── parsing: the contract's shapes or nothing ──
const bad = (): never => {
  throw new GatewayError(502, UNREADABLE);
};
const record = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : bad());
const text = (v: unknown) => (typeof v === "string" ? v : bad());
const nullable = <T>(v: unknown, read: (v: unknown) => T): T | null => (v === null || v === undefined ? null : read(v));
const decimal = (v: unknown) => (typeof v === "string" && /^\d{1,15}(\.\d{1,6})?$/.test(v) ? v : bad());
const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : bad());
const flag = (v: unknown) => (typeof v === "boolean" ? v : bad());
const slug = (v: unknown) => (typeof v === "string" && SLUG.test(v) ? v : bad());
const currency = (v: unknown) => (typeof v === "string" && CURRENCIES.includes(v) ? (v as Currency) : bad());
const status = (v: unknown) => ((LINK_STATUSES as readonly unknown[]).includes(v) ? (v as LinkStatus) : bad());
const color = (v: unknown) => (typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v) ? v : bad());
function https(v: unknown): string {
  try {
    if (new URL(text(v)).protocol === "https:") return v as string;
  } catch {}
  return bad();
}
function items(v: unknown): PageItem[] {
  if (!Array.isArray(v) || v.length < 1 || v.length > 20) return bad();
  return v.map((raw) => ({ name: text(record(raw).name), price: decimal(record(raw).price) }));
}

export function linkOf(v: unknown): Link {
  const r = record(v);
  return {
    id: text(r.id),
    slug: slug(r.slug),
    amount: nullable(r.amount, decimal),
    currency: currency(r.currency),
    description: text(r.description),
    reference_id: nullable(r.reference_id, text),
    single_use: flag(r.single_use),
    status: status(r.status),
    expires_at: nullable(r.expires_at, text),
    created_at: text(r.created_at),
    payments: count(r.payments),
  };
}

function pageFields(r: Record<string, unknown>): PageFields {
  const open = nullable(r.open_amount, record);
  const fields = {
    title: text(r.title),
    description: nullable(r.description, text),
    logo_url: nullable(r.logo_url, https),
    color: nullable(r.color, color),
    currency: currency(r.currency),
    items: nullable(r.items, items),
    open_amount: open && { min: nullable(open.min, decimal), max: nullable(open.max, decimal) },
  };
  return (fields.items === null) === (fields.open_amount === null) ? bad() : fields; // exactly one of the two
}

export const pageOf = (v: unknown): Page => {
  const r = record(v);
  return { id: text(r.id), slug: slug(r.slug), ...pageFields(r), created_at: text(r.created_at), payments: count(r.payments) };
};
export const publicPageOf = (v: unknown): PublicPage => {
  const r = record(v);
  return { slug: slug(r.slug), ...pageFields(r), merchant_name: text(r.merchant_name) };
};

/** One sentence for a failed answer: the gateway's own (its errors are plain sentences by contract), else by status. */
function plainError(status: number, data: unknown, what: string): GatewayError {
  const said = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error.slice(0, MAX_MESSAGE) : null;
  if (said) return new GatewayError(status, said);
  // Next's own 404 page, not the gateway's JSON: claude-contracts' routes aren't on this server yet
  if (status === 404) return new GatewayError(503, `${what} aren't available on this server yet.`);
  if (status === 401) return new GatewayError(401, "Sign in to your merchant dashboard first.");
  if (status === 429) return new GatewayError(429, "Too many tries in a minute. Wait a moment and try again.");
  if (status >= 500) return new GatewayError(status, "The gateway had a problem. Nothing was changed; try again in a minute.");
  return new GatewayError(status, "That didn't work. Check the details and try again.");
}

/** Same origin only; tests pass their own fetch. */
export interface Transport {
  fetch?: typeof fetch;
}

export function gatewayClient({ fetch: send = fetch }: Transport = {}) {
  async function call(path: string, what: string, body?: unknown): Promise<unknown> {
    let res: Response;
    try {
      res = await send(path, {
        method: body === undefined ? "GET" : "POST",
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

  return {
    createLink: async (body: LinkBody) => linkOf(await call("/api/v1/links", "Links", body)),
    cancelLink: async (id: string) => void (await call(`/api/v1/links/${encodeURIComponent(id)}/cancel`, "Links", {})),
    createPage: async (body: PageBody) => pageOf(await call("/api/v1/pages", "Pages", body)),
  };
}

export type GatewayClient = ReturnType<typeof gatewayClient>;

/** The sentence to show for any failure from the client. */
export const errorText = (error: unknown) => (error instanceof GatewayError ? error.message : "Something went wrong. Try again in a minute.");

/** The parsers, the error rule and the transport limits, for the other dashboard clients (lib/gateway-money.ts). */
export const wire = { bad, record, text, nullable, decimal, count, flag, plainError, OFFLINE, TIMEOUT_MS };
