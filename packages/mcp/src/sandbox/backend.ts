// SANDBOX ONLY (batch 052, FR-MCP-16): the contract's HTTP routes served in-process, as a `fetch`. The connector's one
// client talks to it exactly as it talks to the testnet gateway: Bearer key → merchant (never a parameter), scopes,
// key expiry, 404 for another merchant's ids, and Idempotency-Key slots written in the same transaction as the record.
import { canonical } from "../journal.ts";
import { DateError, calendarDate } from "../dates.ts";
import { CURRENCIES, decimal } from "../money.ts";
import { sha256, type SMerchant, type SandboxState, change, read } from "./store.ts";
import type { Account, Scope } from "../contract.ts";
import {
  SandboxHttpError,
  customerJson,
  finalized,
  findInvoice,
  invoiceJson,
  linkDetail,
  linkJson,
  newCustomer,
  newInvoice,
  newLink,
  receivables,
  reminderDraft,
  report,
  searchCustomers,
  today,
} from "./records.ts";

const IDEMPOTENCY_MS = 24 * 60 * 60_000;
const MAX_BODY = 32_768;

interface Caller {
  merchant: SMerchant;
  keyId: string;
  scopes: Scope[];
  expiresAt: number | null;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

function authenticate(state: SandboxState, request: Request, now: number): Caller {
  const auth = request.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const record = key ? state.keys.find((k) => k.hash === sha256(key)) : undefined;
  if (!record || record.revoked_at !== null) throw new SandboxHttpError(401, "Missing or unknown sandbox API key.");
  if (record.expires_at !== null && record.expires_at <= now) throw new SandboxHttpError(401, "This sandbox API key has expired.");
  const merchant = state.merchants.find((m) => m.id === record.merchant_id);
  if (!merchant) throw new SandboxHttpError(401, "Missing or unknown sandbox API key.");
  return { merchant, keyId: record.id, scopes: record.scopes, expiresAt: record.expires_at };
}

function need(caller: Caller, scope: Scope): void {
  if (!caller.scopes.includes(scope)) throw new SandboxHttpError(403, `This API key doesn't have the ${scope} scope. Create a key with it, or use one that has it.`);
}

function body(text: string): Record<string, unknown> {
  if (text.length > MAX_BODY) throw new SandboxHttpError(413, "That request is too large.");
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new SandboxHttpError(400, "Send a JSON body.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new SandboxHttpError(400, "Send a JSON object.");
  return parsed as Record<string, unknown>;
}

const limitParam = (value: string | null, max: number, fallback: number) => {
  if (value === null) return fallback;
  const n = /^\d{1,3}$/.test(value) ? Number(value) : 0;
  if (n < 1 || n > max) throw new SandboxHttpError(400, `limit must be a whole number from 1 to ${max}.`);
  return n;
};

/** An offset cursor: the `next` value of the previous page. */
function page<T>(items: T[], cursor: string | null, limit: number): { data: T[]; next: string | null } {
  const start = cursor === null ? 0 : /^\d{1,6}$/.test(cursor) ? Number(cursor) : -1;
  if (start < 0) throw new SandboxHttpError(400, "cursor must be the `next` value of the previous page.");
  const data = items.slice(start, start + limit);
  return { data, next: start + limit < items.length ? String(start + limit) : null };
}

type Write = (state: SandboxState, caller: Caller, input: Record<string, unknown>, now: number, params: string[]) => { next: SandboxState; status: number; body: unknown };

/** A write: the slot (merchant, route, key) and the record land in one transaction, so a crash can't keep one
 *  without the other; the same key and request replay, a different request is 422; a refusal stores nothing. */
function idempotentWrite(dir: string, request: Request, text: string, route: string, scope: Scope, now: number, params: string[], run: Write): Response {
  const key = request.headers.get("idempotency-key");
  if (!key || key.length > 255) throw new SandboxHttpError(400, "Send an Idempotency-Key header (1 to 255 characters) with every write.");
  const input = body(text);
  const hash = sha256(canonical(input));
  return change(dir, (state) => {
    const caller = authenticate(state, request, now);
    need(caller, scope);
    const live = state.idempotency.filter((s) => now - s.at < IDEMPOTENCY_MS);
    const prior = live.find((s) => s.merchant_id === caller.merchant.id && s.route === route && s.key === key);
    if (prior && prior.hash !== hash) return { result: json(422, { error: "This Idempotency-Key was already used for a different request." }) };
    if (prior) return { result: json(prior.status, prior.body, { "idempotent-replayed": "true" }) };
    const done = run(state, caller, input, now, params);
    const slot = { merchant_id: caller.merchant.id, route, key, hash, status: done.status, body: done.body, at: now };
    return { next: { ...done.next, idempotency: [...live, slot] }, result: json(done.status, done.body) };
  });
}

function account(caller: Caller): Account {
  return {
    merchant: { id: caller.merchant.id, name: caller.merchant.name },
    environment: "sandbox",
    network: null,
    settlement: { asset: "USDT", token: null, decimals: 6 },
    price_currencies: [...CURRENCIES],
    payment_limits: { currency: "USDT", min: "1.00", max: "1000.00" },
    payment_methods: [{ id: "sandbox_simulated", label: "Simulated payments from the sandbox CLI only (no real money, no network)" }],
    timezone: caller.merchant.timezone,
    credential: { type: "sandbox_key", key_id: caller.keyId, scopes: caller.scopes, expires_at: caller.expiresAt === null ? null : new Date(caller.expiresAt).toISOString() },
    capabilities: { links: true, payments: true, reports: true, customers: true, invoices: true, reminders: true },
  };
}

const writes: Record<string, { pattern: RegExp; scope: Scope; run: Write }> = {
  customers: {
    pattern: /^\/api\/v1\/customers$/,
    scope: "customers:write",
    run: (state, caller, input, now) => {
      const customer = newCustomer(state, caller.merchant.id, input, now);
      return { next: { ...state, customers: [...state.customers, customer] }, status: 201, body: customerJson(customer) };
    },
  },
  links: {
    pattern: /^\/api\/v1\/links$/,
    scope: "links:write",
    run: (state, caller, input, now) => {
      const link = newLink(state, caller.merchant.id, input, now);
      const next = { ...state, links: [...state.links, link] };
      return { next, status: 201, body: linkJson(next, link, now) };
    },
  },
  invoices: {
    pattern: /^\/api\/v1\/invoices$/,
    scope: "invoices:write",
    run: (state, caller, input, now) => {
      const invoice = newInvoice(state, caller.merchant, input, now);
      const next = { ...state, invoices: [...state.invoices, invoice] };
      return { next, status: 201, body: invoiceJson(next, invoice, now) };
    },
  },
  finalize: {
    pattern: /^\/api\/v1\/invoices\/([\w-]{1,64})\/finalize$/,
    scope: "invoices:write",
    run: (state, caller, _input, now, [ref]) => {
      const found = findInvoice(state, caller.merchant.id, ref);
      if (!found) throw new SandboxHttpError(404, "No such invoice.");
      const { invoice, merchant } = finalized(caller.merchant, found, now);
      const next = { ...state, invoices: state.invoices.map((i) => (i.id === invoice.id ? invoice : i)), merchants: state.merchants.map((m) => (m.id === merchant.id ? merchant : m)) };
      return { next, status: 200, body: invoiceJson(next, invoice, now) };
    },
  },
};

function get(state: SandboxState, caller: Caller, url: URL, now: number): unknown {
  const path = url.pathname, q = url.searchParams, m = caller.merchant;
  let match: RegExpExecArray | null;
  if (path === "/api/v1/account") return need(caller, "account:read"), account(caller);
  if (path === "/api/v1/customers") {
    need(caller, "customers:read");
    return { data: searchCustomers(state, m.id, q.get("query") ?? "", limitParam(q.get("limit"), 20, 10)).map(customerJson), next: null };
  }
  if ((match = /^\/api\/v1\/links\/([\w-]{1,64})$/.exec(path))) {
    need(caller, "links:read");
    const link = state.links.find((l) => l.id === match![1] && l.merchant_id === m.id);
    if (!link) throw new SandboxHttpError(404, "No such payment link.");
    return linkDetail(state, link, now);
  }
  if ((match = /^\/api\/v1\/invoices\/([\w-]{1,64})\/reminder-draft$/.exec(path))) {
    need(caller, "invoices:read");
    const invoice = findInvoice(state, m.id, match[1]);
    if (!invoice) throw new SandboxHttpError(404, "No such invoice.");
    return reminderDraft(state, m, invoice, now);
  }
  if ((match = /^\/api\/v1\/invoices\/([\w-]{1,64})$/.exec(path))) {
    need(caller, "invoices:read");
    const invoice = findInvoice(state, m.id, match[1]);
    if (!invoice) throw new SandboxHttpError(404, "No such invoice.");
    return invoiceJson(state, invoice, now);
  }
  if (path === "/api/v1/invoices") {
    need(caller, "invoices:read");
    const status = q.get("status"), customer = q.get("customer_id");
    if (status && !["draft", "open", "paid", "overdue"].includes(status)) throw new SandboxHttpError(400, "status must be draft, open, paid or overdue.");
    const dueFrom = q.get("due_from") ? calendarDate(q.get("due_from")!, "due_from") : null;
    const dueTo = q.get("due_to") ? calendarDate(q.get("due_to")!, "due_to") : null;
    const views = state.invoices
      .filter((i) => i.merchant_id === m.id && (!customer || i.customer_id === customer) && (!dueFrom || i.due_date >= dueFrom) && (!dueTo || i.due_date <= dueTo))
      .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
      .map((i) => invoiceJson(state, i, now))
      .filter((v) => !status || (status === "overdue" ? v.overdue : v.status === status));
    return page(views, q.get("cursor"), limitParam(q.get("limit"), 50, 20));
  }
  if (path === "/api/v1/receivables") return need(caller, "invoices:read"), receivables(state, m, now);
  if (path === "/api/v1/payments") {
    need(caller, "payments:read");
    const paid = state.payments
      .filter((p) => p.merchant_id === m.id && p.status === "succeeded")
      .sort((a, b) => (b.succeeded_at ?? 0) - (a.succeeded_at ?? 0) || a.id.localeCompare(b.id))
      .map((p) => {
        const invoice = p.target.kind === "invoice" ? state.invoices.find((i) => i.id === p.target.id) : undefined;
        const link = p.target.kind === "link" ? state.links.find((l) => l.id === p.target.id) : undefined;
        return {
          paymentId: p.id,
          sessionId: null,
          invoiceId: invoice?.id ?? null,
          amount: decimal(BigInt(p.amount), "USDT"),
          refunded: "0.00",
          txHash: null,
          paidAt: new Date(p.succeeded_at!).toISOString(),
          reference: invoice?.number ?? link?.reference_id ?? link?.slug ?? "",
          linkId: link?.id ?? null,
          invoiceNumber: invoice?.number ?? null,
        };
      });
    return page(paid, q.get("cursor"), limitParam(q.get("limit"), 100, 20));
  }
  if (path === "/api/v1/reports") {
    need(caller, "reports:read");
    const tz = q.get("tz") || m.timezone;
    const to = q.get("to") ? calendarDate(q.get("to")!, "to") : today(m, now);
    const from = q.get("from") ? calendarDate(q.get("from")!, "from") : to;
    if (from > to) throw new SandboxHttpError(400, "from must be on or before to.");
    return report(state, m.id, { from, to, tz });
  }
  return undefined;
}

/** The sandbox as a fetch(): only https://sandbox.whiteflow.invalid/api/v1/… exists. */
export function sandboxFetch(dir: string, now: () => number = Date.now): typeof globalThis.fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    try {
      if (request.method === "GET") {
        const state = read(dir);
        const result = get(state, authenticate(state, request, now()), url, now());
        if (result === undefined) return new Response("Not Found", { status: 404 }); // like a route the server doesn't have
        return json(200, result);
      }
      if (request.method === "POST") {
        const text = await request.text();
        for (const [route, write] of Object.entries(writes)) {
          const match = write.pattern.exec(url.pathname);
          if (match) return idempotentWrite(dir, request, text, route, write.scope, now(), match.slice(1), write.run);
        }
        return new Response("Not Found", { status: 404 });
      }
      return json(405, { error: "Method not allowed." });
    } catch (error) {
      if (error instanceof SandboxHttpError) return json(error.status, { error: error.message, ...error.extra });
      if (error instanceof DateError) return json(400, { error: error.message });
      throw error;
    }
  }) as typeof globalThis.fetch;
}
