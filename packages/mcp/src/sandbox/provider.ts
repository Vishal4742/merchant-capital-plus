// SANDBOX ONLY (batch 052, FR-MCP-16): a simulated payment provider and the backend's processing of its events.
// The provider signs each event like the gateway signs its webhooks (MC-Signature: t=<unix s>,v1=HMAC-SHA256, reused
// from packages/sdk). The processor verifies the signature and timestamp, applies each event id once, never moves a
// payment backwards (out-of-order delivery), records under- and overpayment, and `reconcile` rebuilds every invoice's
// paid total from the verified payments. Only a person runs the simulator (src/sandbox/cli.ts); no MCP tool can.
import { constructEvent, signWebhook } from "../../../sdk/index.ts";
import { decimal, display } from "../money.ts";
import { newId, type SEventLog, type SInvoice, type SPayment, type SandboxState, change } from "./store.ts";

const MAX_LOG = 200;
const MAX_EVENT_IDS = 10_000;
type Status = SPayment["status"];
const TYPES: Record<string, Status> = { "payment.pending": "pending", "payment.succeeded": "succeeded", "payment.failed": "failed" };

export interface ProviderEvent {
  id: string;
  type: keyof typeof TYPES;
  created: number;
  data: { payment_id: string; merchant_id: string; target: { kind: "invoice" | "link"; id: string }; amount: string; currency: "USDT"; sequence: number; provider_ref: string };
}
export interface Delivery {
  event_id: string;
  type: string;
  outcome: SEventLog["outcome"];
  reason: string;
}

const log = (state: SandboxState, entry: SEventLog): SandboxState => ({ ...state, event_log: [...state.event_log, entry].slice(-MAX_LOG) });

function valid(event: unknown): event is ProviderEvent {
  const e = event as ProviderEvent;
  const d = e?.data;
  return (
    !!e && typeof e.id === "string" && /^evt_[\w-]{8,64}$/.test(e.id) && typeof e.type === "string" && e.type in TYPES &&
    !!d && /^pay_[\w-]{8,64}$/.test(d.payment_id) && typeof d.merchant_id === "string" && /^\d{1,15}$/.test(d.amount) && d.amount !== "0" &&
    d.currency === "USDT" && Number.isSafeInteger(d.sequence) && d.sequence > 0 && (d.target?.kind === "invoice" || d.target?.kind === "link") && typeof d.target.id === "string"
  );
}

/** One invoice's paid projection after `amount` more arrived. A paid invoice stays paid; extra shows as overpaid. */
function credit(invoice: SInvoice, amount: bigint, now: number): SInvoice {
  const paid = BigInt(invoice.amount_paid) + amount;
  const complete = paid >= BigInt(invoice.total);
  return { ...invoice, amount_paid: paid.toString(), status: complete ? "paid" : invoice.status, paid_at: complete ? (invoice.paid_at ?? now) : invoice.paid_at };
}

/** The backend's webhook handler for the provider: `raw` exactly as received and its MC-Signature header. */
export function processEvent(dir: string, raw: string, header: string | null, now: number = Date.now()): Delivery {
  return change<Delivery>(dir, (state) => {
    const reject = (id: string, type: string, reason: string) => ({ next: log(state, { id, type, at: now, outcome: "rejected", reason }), result: { event_id: id, type, outcome: "rejected" as const, reason } });
    let event: unknown;
    try {
      event = constructEvent(raw, header, state.webhook_secret, { toleranceSec: 300 });
    } catch (error) {
      return reject("(unverified)", "(unverified)", `signature check failed: ${(error as Error).message}`);
    }
    if (!valid(event)) return reject("(invalid)", "(invalid)", "the event's fields are missing or malformed");
    const { id, type, data } = event;
    if (state.processed_events.includes(id)) {
      return { next: log(state, { id, type, at: now, outcome: "duplicate", reason: "already processed" }), result: { event_id: id, type, outcome: "duplicate", reason: "already processed: applied once only" } };
    }
    const seen = { ...state, processed_events: [...state.processed_events, id].slice(-MAX_EVENT_IDS) };
    const target = data.target.kind === "invoice" ? seen.invoices.find((i) => i.id === data.target.id && i.merchant_id === data.merchant_id) : seen.links.find((l) => l.id === data.target.id && l.merchant_id === data.merchant_id);
    if (!target) return { ...reject(id, type, "unknown merchant or target"), next: log(seen, { id, type, at: now, outcome: "rejected", reason: "unknown merchant or target" }) };
    const status = TYPES[type];
    const prior = seen.payments.find((p) => p.id === data.payment_id);
    if (prior && (prior.merchant_id !== data.merchant_id || prior.target.id !== data.target.id || prior.amount !== data.amount)) {
      return { next: log(seen, { id, type, at: now, outcome: "rejected", reason: "event disagrees with the recorded payment" }), result: { event_id: id, type, outcome: "rejected", reason: "event disagrees with the recorded payment" } };
    }
    if (prior && (data.sequence <= prior.sequence || prior.status !== "pending")) {
      const reason = prior.status !== "pending" ? `payment is already ${prior.status}; a late ${status} can't change it` : `older than the state already applied (sequence ${data.sequence} ≤ ${prior.sequence})`;
      return { next: log(seen, { id, type, at: now, outcome: "stale", reason }), result: { event_id: id, type, outcome: "stale", reason } };
    }
    const payment: SPayment = prior
      ? { ...prior, status, sequence: data.sequence, succeeded_at: status === "succeeded" ? now : null }
      : { id: data.payment_id, merchant_id: data.merchant_id, target: data.target, amount: data.amount, currency: "USDT", status, sequence: data.sequence, created_at: now, succeeded_at: status === "succeeded" ? now : null, provider_ref: data.provider_ref };
    let next: SandboxState = { ...seen, payments: prior ? seen.payments.map((p) => (p.id === payment.id ? payment : p)) : [...seen.payments, payment] };
    let reason = `payment ${status}`;
    if (status === "succeeded" && data.target.kind === "invoice") {
      const invoice = target as SInvoice;
      if (invoice.status === "draft") {
        reason = "payment recorded, but the invoice is a draft: it was not credited (reconcile reports it)";
      } else {
        const credited = credit(invoice, BigInt(data.amount), now);
        next = { ...next, invoices: next.invoices.map((i) => (i.id === invoice.id ? credited : i)) };
        const due = BigInt(credited.total) - BigInt(credited.amount_paid);
        reason = due > 0n ? `underpaid: ${display(due, "USDT")} still due` : due < 0n ? `overpaid by ${display(-due, "USDT")}` : "invoice paid in full";
      }
    }
    return { next: log(next, { id, type, at: now, outcome: "applied", reason }), result: { event_id: id, type, outcome: "applied", reason } };
  });
}

export type Scenario = "normal" | "duplicate" | "out-of-order" | "bad-signature" | "fail";

/** The provider: a payment of `amount` (USDT units; default what's due) for an invoice number or id, or a link id or
 *  slug, delivered as signed events in the scenario's order. Returns every delivery's outcome. */
export function simulatePayment(dir: string, ref: string, opts: { amountUnits?: bigint; scenario?: Scenario } = {}, now: () => number = Date.now): { payment_id: string; amount: string; deliveries: Delivery[] } {
  const { target, merchantId, amount } = change(dir, (state) => ({ result: resolve(state, ref, opts.amountUnits) }));
  const secret = change(dir, (state) => ({ result: state.webhook_secret }));
  const paymentId = newId("pay"), providerRef = newId("sbxref");
  const make = (type: ProviderEvent["type"], sequence: number): ProviderEvent => ({
    id: newId("evt"),
    type,
    created: Math.floor(now() / 1000),
    data: { payment_id: paymentId, merchant_id: merchantId, target, amount: amount.toString(), currency: "USDT", sequence, provider_ref: providerRef },
  });
  const pending = make("payment.pending", 1), final = make(opts.scenario === "fail" ? "payment.failed" : "payment.succeeded", 2);
  const order = opts.scenario === "out-of-order" ? [final, pending] : opts.scenario === "duplicate" ? [pending, final, final] : [pending, final];
  const deliveries = order.map((event) => {
    const raw = JSON.stringify(event);
    const header = signWebhook(raw, opts.scenario === "bad-signature" ? `${secret}-wrong` : secret); // signed at real time: the processor checks a 5-minute window
    return processEvent(dir, raw, header, now());
  });
  return { payment_id: paymentId, amount: decimal(amount, "USDT"), deliveries };
}

function resolve(state: SandboxState, ref: string, override?: bigint): { target: ProviderEvent["data"]["target"]; merchantId: string; amount: bigint } {
  const upper = ref.toUpperCase();
  const invoices = state.invoices.filter((i) => i.id === ref || i.number === upper);
  const links = state.links.filter((l) => l.id === ref || l.slug === ref);
  if (invoices.length + links.length === 0) throw new Error(`No sandbox invoice or link matches ${ref}.`);
  if (invoices.length + links.length > 1) throw new Error(`${ref} matches more than one sandbox record (several merchants); use its id instead.`);
  if (override !== undefined && override <= 0n) throw new Error("The amount must be more than 0.");
  if (invoices.length) {
    const invoice = invoices[0];
    if (invoice.status === "draft") throw new Error(`${invoice.id} is a draft: finalize it first (a customer can't pay a draft).`);
    const due = BigInt(invoice.total) - BigInt(invoice.amount_paid);
    const amount = override ?? due;
    if (amount <= 0n) throw new Error(`${invoice.number} has nothing left to pay; pass an amount to simulate an overpayment.`);
    return { target: { kind: "invoice", id: invoice.id }, merchantId: invoice.merchant_id, amount };
  }
  const link = links[0];
  if (override !== undefined) return { target: { kind: "link", id: link.id }, merchantId: link.merchant_id, amount: override };
  if (link.amount === null) throw new Error("This link lets the payer choose the amount: pass --amount (USDT).");
  if (link.currency === "USDT") return { target: { kind: "link", id: link.id }, merchantId: link.merchant_id, amount: BigInt(link.amount) };
  if (link.currency === "USD") return { target: { kind: "link", id: link.id }, merchantId: link.merchant_id, amount: BigInt(link.amount) * 10_000n }; // 1:1, 2 → 6 decimals
  throw new Error(`This link is priced in ${link.currency}; the sandbox has no exchange rates, so pass the USDT amount the customer pays with --amount.`);
}

/** Rebuilds each invoice's paid total from its succeeded payments and reports (and fixes) any drift. */
export function reconcile(dir: string, now: number = Date.now()): { checked: number; drift: { invoice: string; recorded: string; verified: string }[] } {
  return change(dir, (state) => {
    const drift: { invoice: string; recorded: string; verified: string }[] = [];
    const invoices = state.invoices.map((invoice) => {
      if (invoice.status === "draft") return invoice;
      const verified = state.payments.filter((p) => p.status === "succeeded" && p.target.kind === "invoice" && p.target.id === invoice.id).reduce((sum, p) => sum + BigInt(p.amount), 0n);
      if (verified === BigInt(invoice.amount_paid)) return invoice;
      drift.push({ invoice: invoice.number ?? invoice.id, recorded: decimal(BigInt(invoice.amount_paid), "USDT"), verified: decimal(verified, "USDT") });
      const complete = verified >= BigInt(invoice.total);
      return { ...invoice, amount_paid: verified.toString(), status: complete ? ("paid" as const) : ("open" as const), paid_at: complete ? (invoice.paid_at ?? now) : null };
    });
    return { next: drift.length ? { ...state, invoices } : undefined, result: { checked: invoices.length, drift } };
  });
}
