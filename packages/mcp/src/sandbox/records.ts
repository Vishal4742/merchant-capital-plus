// SANDBOX ONLY (batch 052, FR-MCP-13/14/16/17): the contract's records as the simulator keeps them. Validation and
// state transitions mirror the contract (API-CONTRACT.md); money uses src/money.ts, the same integer code the tools use.
import type { Approval, Customer, Invoice, Link, LinkDetail, Receivables, ReminderDraft, Report } from "../contract.ts";
import { canonical } from "../journal.ts";
import { addDays, calendarDate, dateIn, labelled } from "../dates.ts";
import { CURRENCIES, DIGITS, MoneyError, bpsToPercent, decimal, display, invoiceTotals, isCurrency, parseMoney, type Currency, type DiscountInput, type TaxInput } from "../money.ts";
import { maskEmail, untrusted } from "../safety.ts";
import { newId, sha256, type SApproval, type SCustomer, type SInvoice, type SLink, type SMerchant, type SPayment, type SandboxState } from "./store.ts";

export const SANDBOX_BASE = "https://sandbox.whiteflow.invalid";
export const APPROVAL_TTL_MS = 48 * 60 * 60_000;
export const MIN_USDT = 1_000_000n; // the gateway's 1 USDT minimum (apps/web MIN_PAYMENT)
export const MAX_USDT = 1_000_000_000n; // and its 1,000 USDT testnet maximum (MAX_PAYMENT)
const MAX_LINES = 50;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export class SandboxHttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const bad = (message: string) => new SandboxHttpError(400, message);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
const usdt = (units: string | bigint) => decimal(BigInt(units), "USDT");

function money<T>(work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof MoneyError) throw bad(error.message);
    throw error;
  }
}

function text(value: unknown, name: string, { max, required = true }: { max: number; required?: boolean }): string | null {
  if (value !== undefined && value !== null && typeof value !== "string") throw bad(`${name} must be text.`);
  const clean = untrusted(value ?? "", max + 1);
  if (clean.length > max) throw bad(`${name} must be at most ${max} characters.`);
  if (!clean && required) throw bad(`${name} is required.`);
  return clean || null;
}

export const today = (merchant: SMerchant, now: number) => dateIn(now, merchant.timezone);

// ---- customers ---------------------------------------------------------------------------------------------------

/** Lowercased letters and digits only, so "ACME Ltd." and "acme ltd" match. */
export const normalizeName = (name: string) => name.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

export const customerJson = (c: SCustomer): Customer => ({
  id: c.id,
  name: c.name,
  email_masked: maskEmail(c.email),
  created_at: iso(c.created_at)!,
});

export function searchCustomers(state: SandboxState, merchantId: string, query: string, limit: number): SCustomer[] {
  const q = query.trim().toLowerCase(), qn = normalizeName(query);
  if (!q) throw bad("query is required.");
  return state.customers
    .filter((c) => c.merchant_id === merchantId && ((qn && normalizeName(c.name).includes(qn)) || (c.email ?? "").includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, limit);
}

export function newCustomer(state: SandboxState, merchantId: string, body: Record<string, unknown>, now: number): SCustomer {
  const name = text(body.name, "name", { max: 100 })!;
  const email = text(body.email, "email", { max: 254, required: false })?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) throw bad("email must be an address like priya@example.com.");
  if (body.confirm_new !== undefined && typeof body.confirm_new !== "boolean") throw bad("confirm_new must be true or false.");
  const duplicates = state.customers.filter((c) => c.merchant_id === merchantId && (normalizeName(c.name) === normalizeName(name) || (email !== null && c.email === email)));
  if (duplicates.length && body.confirm_new !== true) {
    throw new SandboxHttpError(409, "A customer with this name or email already exists.", { possible_duplicates: duplicates.map(customerJson) });
  }
  return { id: newId("cus"), merchant_id: merchantId, name, email, created_at: now };
}

// ---- links (the live shape of apps/web linkJson) -----------------------------------------------------------------

export function linkStatus(link: SLink, paid: number, now: number): Link["status"] {
  if (link.single_use && paid > 0) return "paid";
  if (link.expires_at !== null && link.expires_at <= now) return "expired";
  return "active";
}

const succeededFor = (state: SandboxState, kind: "invoice" | "link", id: string) =>
  state.payments.filter((p) => p.target.kind === kind && p.target.id === id && p.status === "succeeded");

export function linkJson(state: SandboxState, link: SLink, now: number): Link {
  const paid = succeededFor(state, "link", link.id).length;
  return {
    id: link.id,
    slug: link.slug,
    url: `/l/${link.slug}`,
    amount: link.amount === null ? null : decimal(BigInt(link.amount), link.currency as Currency),
    currency: link.currency,
    description: link.description,
    reference_id: link.reference_id,
    customer_id: link.customer_id,
    single_use: link.single_use,
    status: linkStatus(link, paid, now),
    expires_at: iso(link.expires_at),
    created_at: iso(link.created_at)!,
    payments: paid,
  };
}

export const linkDetail = (state: SandboxState, link: SLink, now: number): LinkDetail => ({
  ...linkJson(state, link, now),
  paid_checkouts: succeededFor(state, "link", link.id)
    .sort((a, b) => (b.succeeded_at ?? 0) - (a.succeeded_at ?? 0))
    .map((p) => ({ session_id: p.id, payment_id: p.id, amount: usdt(p.amount), currency: "USDT", tx_hash: null, paid_at: iso(p.succeeded_at) })),
});

export function newLink(state: SandboxState, merchantId: string, body: Record<string, unknown>, now: number): SLink {
  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
  if (!isCurrency(currency)) throw bad(`currency must be one of ${CURRENCIES.join(", ")}.`);
  const amount = body.amount === undefined || body.amount === null ? null : money(() => parseMoney(String(body.amount), currency).units);
  // like the gateway: USDT and USD (1:1) must be 1..1,000 USDT now; other currencies are checked at the checkout's rate,
  // which the sandbox doesn't have (no FX here: the simulator never converts)
  if (amount !== null && (currency === "USDT" || currency === "USD")) {
    const asUsdt = currency === "USDT" ? amount : amount * 10n ** BigInt(DIGITS.USDT - DIGITS.USD);
    if (asUsdt < MIN_USDT || asUsdt > MAX_USDT) throw bad("amount must be between 1 and 1,000.");
  }
  const description = text(body.description, "description", { max: 200 })!;
  const reference = text(body.reference_id, "reference_id", { max: 40, required: false });
  if (reference && state.links.some((l) => l.merchant_id === merchantId && l.reference_id === reference)) throw new SandboxHttpError(409, "You already have a link with that reference_id.");
  if (body.single_use !== undefined && typeof body.single_use !== "boolean") throw bad("single_use must be true or false.");
  let expiresAt: number | null = null;
  if (body.expires_at !== undefined && body.expires_at !== null) {
    expiresAt = typeof body.expires_at === "string" ? Date.parse(body.expires_at) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw bad("expires_at must be a time in the future.");
  }
  const customerId = body.customer_id === undefined || body.customer_id === null ? null : String(body.customer_id);
  if (customerId && !state.customers.some((c) => c.id === customerId && c.merchant_id === merchantId)) throw new SandboxHttpError(404, "No such customer.");
  const slug = newId("s").slice(2, 12);
  return { id: newId("lnk"), merchant_id: merchantId, slug, amount: amount?.toString() ?? null, currency, description, reference_id: reference, customer_id: customerId, single_use: body.single_use === true, expires_at: expiresAt, created_at: now };
}

// ---- invoices ----------------------------------------------------------------------------------------------------

export const hostedUrl = (invoice: SInvoice) => (invoice.status === "draft" ? null : `${SANDBOX_BASE}/i/${invoice.id}`);

export function invoiceJson(state: SandboxState, invoice: SInvoice, now: number): Invoice {
  const merchant = state.merchants.find((m) => m.id === invoice.merchant_id)!;
  const customer = state.customers.find((c) => c.id === invoice.customer_id);
  const currency = invoice.currency as Currency;
  const fmt = (units: string | bigint) => decimal(BigInt(units), currency);
  const total = BigInt(invoice.total), paid = BigInt(invoice.amount_paid);
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    revision: invoice.revision,
    overdue: invoice.status === "open" && invoice.due_date < today(merchant, now),
    customer: { id: invoice.customer_id, name: customer?.name ?? "(deleted customer)" },
    currency,
    line_items: invoice.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: fmt(l.unit_price), amount: fmt(l.amount) })),
    subtotal: fmt(invoice.subtotal),
    discount: invoice.discount ? { type: invoice.discount.type, percent: invoice.discount.bps ? bpsToPercent(BigInt(invoice.discount.bps)) : null, amount: fmt(invoice.discount.amount) } : null,
    tax: invoice.tax ? { name: invoice.tax.name, rate_percent: bpsToPercent(BigInt(invoice.tax.bps)), amount: fmt(invoice.tax.amount) } : null,
    total: fmt(total),
    amount_paid: fmt(paid),
    amount_due: fmt(total > paid ? total - paid : 0n),
    overpaid: fmt(paid > total ? paid - total : 0n),
    due_date: invoice.due_date,
    timezone: merchant.timezone,
    memo: invoice.memo,
    hosted_url: hostedUrl(invoice),
    pdf_url: null,
    created_at: iso(invoice.created_at)!,
    finalized_at: iso(invoice.finalized_at),
    paid_at: iso(invoice.paid_at),
    approval: latestApproval(state, invoice.id, now),
    payments: succeededFor(state, "invoice", invoice.id).map((p) => ({ id: p.id, amount: usdt(p.amount), currency: "USDT", status: "succeeded", paid_at: iso(p.succeeded_at)!, evidence: `sandbox:${p.provider_ref}` })),
  };
}

/** The editable content of a draft, validated (create and update share it). */
function draftFields(state: SandboxState, merchant: SMerchant, body: Record<string, unknown>, now: number): Omit<SInvoice, "id" | "merchant_id" | "number" | "status" | "revision" | "amount_paid" | "created_at" | "finalized_at" | "paid_at"> {
  const customerId = typeof body.customer_id === "string" ? body.customer_id : "";
  if (!state.customers.some((c) => c.id === customerId && c.merchant_id === merchant.id)) throw new SandboxHttpError(404, "No such customer: search_customers or create_customer first, then use its id.");
  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "";
  if (currency !== "USDT") throw bad("Invoices are issued in USDT, the settlement asset. Whiteflow never converts an invoice's currency: give the amounts in USDT, or use a payment link priced in another currency.");
  if (!Array.isArray(body.line_items) || body.line_items.length === 0 || body.line_items.length > MAX_LINES) throw bad(`line_items must be a list of 1 to ${MAX_LINES} items.`);
  const lines = body.line_items.map((raw, i) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    return { description: text(item.description, `Line ${i + 1} description`, { max: 200 })!, quantity: item.quantity as number, unit_price: item.unit_price as string };
  });
  const totals = money(() => invoiceTotals("USDT", lines, (body.discount ?? null) as DiscountInput | null, (body.tax ?? null) as TaxInput | null));
  if (totals.total < MIN_USDT || totals.total > MAX_USDT) throw bad(`The total is ${display(totals.total, "USDT")}; an invoice must total between 1 and 1,000 USDT (the testnet payment limits).`);
  const dueDate = (() => {
    try {
      return calendarDate(String(body.due_date ?? ""), "due_date");
    } catch (error) {
      throw bad((error as Error).message);
    }
  })();
  const local = today(merchant, now);
  if (dueDate < local) throw bad(`due_date ${dueDate} is in the past (today is ${labelled(local, merchant.timezone)}).`);
  if (dueDate > addDays(local, 366 * 2)) throw bad("due_date must be within two years.");
  const memo = text(body.memo, "memo", { max: 500, required: false });
  return {
    customer_id: customerId,
    currency,
    line_items: totals.lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice.toString(), amount: l.amount.toString() })),
    subtotal: totals.subtotal.toString(),
    discount: totals.discount ? { type: totals.discount.type, bps: totals.discount.bps?.toString() ?? null, amount: totals.discount.amount.toString() } : null,
    tax: totals.tax ? { name: untrusted(totals.tax.name, 40), bps: totals.tax.bps.toString(), amount: totals.tax.amount.toString() } : null,
    total: totals.total.toString(),
    memo,
    due_date: dueDate,
  };
}

export function newInvoice(state: SandboxState, merchant: SMerchant, body: Record<string, unknown>, now: number): SInvoice {
  const fields = draftFields(state, merchant, body, now);
  return { id: newId("inv"), merchant_id: merchant.id, number: null, status: "draft", revision: 1, amount_paid: "0", created_at: now, finalized_at: null, paid_at: null, ...fields };
}

/** A draft edit: only a draft, only against the revision the caller read (409 otherwise). It makes a new revision
 *  and supersedes any pending approval of the old one (F4: an approval covers exactly one version). */
export function updatedDraft(state: SandboxState, merchant: SMerchant, invoice: SInvoice, body: Record<string, unknown>, now: number): { invoice: SInvoice; approvals: SApproval[] } {
  if (invoice.status !== "draft") throw new SandboxHttpError(409, `Invoice ${invoice.number} is ${invoice.status}; only a draft can be edited.`);
  if (body.revision !== invoice.revision) throw new SandboxHttpError(409, `This draft changed since it was read (now revision ${invoice.revision}). Read it again, then edit.`);
  const next = { ...invoice, ...draftFields(state, merchant, { currency: invoice.currency, ...body }, now), revision: invoice.revision + 1 };
  const approvals = state.approvals.map((a) => (a.invoice_id === invoice.id && a.status === "pending" ? { ...a, status: "superseded" as const, decided_at: now } : a));
  return { invoice: next, approvals };
}

/** What an approval binds: everything a customer would be asked to pay against (F4). */
export const contentHash = (i: SInvoice) => sha256(canonical({ customer_id: i.customer_id, currency: i.currency, line_items: i.line_items, subtotal: i.subtotal, discount: i.discount, tax: i.tax, total: i.total, memo: i.memo, due_date: i.due_date }));

export function approvalJson(approval: SApproval, now: number): Approval {
  const status = approval.status === "pending" && approval.expires_at <= now ? "expired" : approval.status;
  return {
    id: approval.id,
    invoice_id: approval.invoice_id,
    revision: approval.revision,
    status,
    total: decimal(BigInt(approval.total), approval.currency as Currency),
    currency: approval.currency,
    customer_id: approval.customer_id,
    requested_at: iso(approval.requested_at)!,
    expires_at: iso(approval.expires_at)!,
    decided_at: iso(approval.decided_at),
    review_url: `${SANDBOX_BASE}/review/${approval.id}`,
  };
}

function latestApproval(state: SandboxState, invoiceId: string, now: number): Approval | null {
  const latest = state.approvals.filter((a) => a.invoice_id === invoiceId).sort((a, b) => b.requested_at - a.requested_at)[0];
  return latest ? approvalJson(latest, now) : null;
}

/** finalize under the Owner-approval policy: an approval request for the draft's current revision (one per revision:
 *  asking again returns the pending one). The caller must name the revision it reviewed. Publishes nothing. */
export function publicationRequest(state: SandboxState, merchant: SMerchant, invoice: SInvoice, body: Record<string, unknown>, now: number): SApproval {
  if (invoice.status !== "draft") throw new SandboxHttpError(409, `Invoice ${invoice.number} is already ${invoice.status}; only a draft can be published.`);
  if (body.revision !== invoice.revision) throw new SandboxHttpError(409, `This draft changed since it was reviewed (now revision ${invoice.revision}). Review it again before asking to publish.`);
  const local = today(merchant, now);
  if (invoice.due_date < local) throw new SandboxHttpError(422, `This draft's due date ${invoice.due_date} has passed (today is ${local}). Update the due date first.`);
  const hash = contentHash(invoice);
  const pending = state.approvals.find((a) => a.invoice_id === invoice.id && a.status === "pending" && a.revision === invoice.revision && a.hash === hash && a.expires_at > now);
  if (pending) return pending;
  return { id: newId("apr"), merchant_id: merchant.id, invoice_id: invoice.id, revision: invoice.revision, hash, total: invoice.total, currency: invoice.currency, customer_id: invoice.customer_id, requested_at: now, expires_at: now + APPROVAL_TTL_MS, status: "pending", decided_at: null };
}

/** The Owner's decision (sandbox stand-in for the authenticated review page): once, before expiry, and only if the
 *  invoice is still exactly the version that was approved. Approving publishes it (number, payment URL). */
export function decide(state: SandboxState, approvalId: string, decision: "approve" | "reject", now: number): { next: SandboxState; outcome: SApproval["status"] } {
  const approval = state.approvals.find((a) => a.id === approvalId);
  if (!approval) throw new Error(`No sandbox approval ${approvalId}.`);
  const view = approvalJson(approval, now);
  if (view.status !== "pending") throw new Error(`Approval ${approvalId} is ${view.status}; it can't be decided (again).`);
  const invoice = state.invoices.find((i) => i.id === approval.invoice_id)!;
  const decided = (status: SApproval["status"]) => state.approvals.map((a) => (a.id === approvalId ? { ...a, status, decided_at: now } : a));
  if (decision === "reject") return { next: { ...state, approvals: decided("rejected") }, outcome: "rejected" };
  if (invoice.status !== "draft" || invoice.revision !== approval.revision || contentHash(invoice) !== approval.hash || invoice.total !== approval.total) {
    return { next: { ...state, approvals: decided("superseded") }, outcome: "superseded" };
  }
  const merchant = state.merchants.find((m) => m.id === invoice.merchant_id)!;
  const { invoice: open, merchant: numbered } = finalized(merchant, invoice, now);
  return {
    next: {
      ...state,
      approvals: decided("approved"),
      invoices: state.invoices.map((i) => (i.id === open.id ? open : i)),
      merchants: state.merchants.map((m) => (m.id === numbered.id ? numbered : m)),
    },
    outcome: "approved",
  };
}

/** draft → open only; the number is the merchant's next WF-<n>. Nothing is sent to anyone. */
export function finalized(merchant: SMerchant, invoice: SInvoice, now: number): { invoice: SInvoice; merchant: SMerchant } {
  if (invoice.status !== "draft") throw new SandboxHttpError(409, `Invoice ${invoice.number} is already ${invoice.status}; only a draft can be finalized.`);
  const local = today(merchant, now);
  if (invoice.due_date < local) throw new SandboxHttpError(422, `This draft's due date ${invoice.due_date} has passed (today is ${local}). Create a new draft with a later due date.`);
  return {
    invoice: { ...invoice, status: "open", number: `WF-${merchant.next_number}`, finalized_at: now },
    merchant: { ...merchant, next_number: merchant.next_number + 1 },
  };
}

export function findInvoice(state: SandboxState, merchantId: string, ref: string): SInvoice | undefined {
  const upper = ref.toUpperCase();
  return state.invoices.find((i) => i.merchant_id === merchantId && (i.id === ref || (i.number !== null && i.number === upper)));
}

export function reminderDraft(state: SandboxState, merchant: SMerchant, invoice: SInvoice, now: number): ReminderDraft {
  if (invoice.status !== "open") throw new SandboxHttpError(409, invoice.status === "draft" ? "This invoice is still a draft: finalize it before preparing a reminder." : "This invoice is paid: no reminder needed.");
  const customer = state.customers.find((c) => c.id === invoice.customer_id)!;
  const view = invoiceJson(state, invoice, now);
  const due = display(BigInt(invoice.total) - BigInt(invoice.amount_paid), "USDT");
  const when = view.overdue ? `was due on ${labelled(invoice.due_date, merchant.timezone)} and is now overdue` : `is due on ${labelled(invoice.due_date, merchant.timezone)}`;
  return {
    invoice_id: invoice.id,
    number: invoice.number!,
    recipient: { customer_id: customer.id, name: customer.name, email: customer.email },
    subject: `${view.overdue ? "Overdue" : "Reminder"}: invoice ${invoice.number} from ${merchant.name}`,
    body: [
      `Hello ${customer.name},`,
      "",
      `This is a reminder that invoice ${invoice.number} from ${merchant.name} ${when}.`,
      `Amount due: ${due}`,
      "",
      `You can pay it here: ${view.hosted_url}`,
      "",
      "Thank you,",
      merchant.name,
    ].join("\n"),
    payment_url: view.hosted_url!,
    sent: false,
  };
}

export function receivables(state: SandboxState, merchant: SMerchant, now: number): Receivables {
  const by: Receivables["by_currency"] = {};
  const sums = new Map<string, { outstanding: bigint; overdue: bigint; open: number; late: number }>();
  for (const invoice of state.invoices.filter((i) => i.merchant_id === merchant.id && i.status === "open")) {
    const view = invoiceJson(state, invoice, now);
    const due = BigInt(invoice.total) - BigInt(invoice.amount_paid);
    const row = sums.get(invoice.currency) ?? { outstanding: 0n, overdue: 0n, open: 0, late: 0 };
    sums.set(invoice.currency, { outstanding: row.outstanding + due, overdue: row.overdue + (view.overdue ? due : 0n), open: row.open + 1, late: row.late + (view.overdue ? 1 : 0) });
  }
  for (const [currency, row] of sums) {
    by[currency] = { outstanding: decimal(row.outstanding, currency as Currency), overdue: decimal(row.overdue, currency as Currency), open_count: row.open, overdue_count: row.late };
  }
  return { as_of: today(merchant, now), timezone: merchant.timezone, by_currency: by };
}

/** The live report's shape from simulated succeeded payments. The simulator charges no fees and has no refunds. */
export function report(state: SandboxState, merchantId: string, range: { from: string; to: string; tz: string }): Report {
  const paid = state.payments.filter((p) => p.merchant_id === merchantId && p.status === "succeeded" && p.succeeded_at !== null);
  const inDay = (p: SPayment) => dateIn(p.succeeded_at!, range.tz);
  const totals = (list: SPayment[]) => {
    const gross = list.reduce((sum, p) => sum + BigInt(p.amount), 0n);
    return { gross: usdt(gross), fees: usdt(0n), net: usdt(gross), refunds: usdt(0n), count: list.length };
  };
  const days: Report["days"] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) days.push({ date, ...totals(paid.filter((p) => inDay(p) === date)) });
  return { from: range.from, to: range.to, tz: range.tz, days, totals: totals(paid.filter((p) => inDay(p) >= range.from && inDay(p) <= range.to)) };
}
