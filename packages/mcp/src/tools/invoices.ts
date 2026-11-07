// create_invoice_draft, update_invoice_draft, finalize_invoice, get_invoice, list_invoices, prepare_invoice_reminder
// (batch 052, FR-MCP-14, FR-MCP-17; round 2: production review F3/F4, human decision "Owner approves on review page").
// Totals are integer arithmetic (src/money.ts); the server's must equal the connector's own, or the draft is blocked
// from publication. Publishing needs an Owner's approval on the review page, bound by the server to the exact
// revision, total, currency and customer; a model-supplied confirmation is never approval. Nothing here sends anything.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Approval, Invoice } from "../contract.ts";
import { DateError, calendarDate, daysBetween, labelled } from "../dates.ts";
import { MoneyError, decimal, display, fromApi, invoiceTotals, type Currency, type DiscountInput, type TaxInput } from "../money.ts";
import { DATA_NOTICE, ToolRefusal, untrusted } from "../safety.ts";
import { createAnother, idempotencyKey } from "./business.ts";
import { Mismatch, RECORD_ID, dueLabel, replayNote, type Ctx, type Profile } from "./context.ts";

const REF = /^(inv_[A-Za-z0-9_-]{1,40}|WF-\d{1,9})$/i;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const invoiceRef = z.string().regex(RECORD_ID, "letters, digits, _ or -").describe("The invoice id (inv_…) or its number (WF-1042).");
const lineItems = z
  .array(
    z.object({
      description: z.string().min(1).max(200),
      quantity: z.number().int().min(1).max(10_000),
      unit_price: z.string().max(30).describe('Decimal string, e.g. "2000.00".'),
    }),
  )
  .min(1)
  .max(50);
const discount = z
  .union([z.object({ type: z.literal("amount"), amount: z.string().max(30) }), z.object({ type: z.literal("percent"), percent: z.string().max(6) })])
  .describe("Only if the merchant asked for one.");
const tax = z.object({ name: z.string().min(1).max(40), rate_percent: z.string().max(6) }).describe("Only a tax the merchant explicitly named, with its rate. Never infer one.");

function checkRef(ref: string): string {
  if (!REF.test(ref)) throw new ToolRefusal("Give an invoice number like WF-1042 or an id like inv_…; use list_invoices to find it.");
  return ref;
}

const refuse = <T>(work: () => T): T => {
  try {
    return work();
  } catch (error) {
    if (error instanceof MoneyError || error instanceof DateError) throw new ToolRefusal(error.message);
    throw error;
  }
};

/** The connector's own totals for an invoice as returned: the same integer code the server uses (FR-MCP-14). */
function recompute(invoice: Invoice): bigint {
  const discountIn: DiscountInput | null = invoice.discount ? (invoice.discount.type === "percent" ? { type: "percent", percent: invoice.discount.percent ?? "0" } : { type: "amount", amount: invoice.discount.amount }) : null;
  const taxIn: TaxInput | null = invoice.tax ? { name: invoice.tax.name, rate_percent: invoice.tax.rate_percent } : null;
  return invoiceTotals(invoice.currency as Currency, invoice.line_items, discountIn, taxIn).total;
}

function approvalOut(ctx: Ctx, approval: Approval | null) {
  if (!approval) return null;
  let review: string;
  try {
    review = ctx.trustedUrl(approval.review_url, "the review URL");
  } catch (error) {
    if (error instanceof Mismatch) throw new ToolRefusal(`Whiteflow returned a review URL that isn't on a trusted origin (${error.message}).`);
    throw error;
  }
  return { id: approval.id, status: approval.status, revision: approval.revision, total: approval.total, currency: approval.currency, expires_at: approval.expires_at, review_url: review };
}

function invoiceOut(ctx: Ctx, invoice: Invoice, profile: Profile) {
  const c = invoice.currency as Currency;
  const show = (text: string) => display(fromApi(text, c), c);
  const overdueDays = invoice.overdue ? daysBetween(invoice.due_date, profile.today) : 0;
  const url = (value: string | null, what: string) => {
    if (value === null) return null;
    try {
      return ctx.trustedUrl(value, what);
    } catch (error) {
      if (error instanceof Mismatch) throw new ToolRefusal(`Whiteflow returned ${what} that isn't on a trusted origin (${error.message}). Don't share it; check the invoice in the dashboard.`);
      throw error;
    }
  };
  const awaiting = invoice.status === "draft" && invoice.approval?.status === "pending";
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.overdue ? "open (overdue)" : awaiting ? "draft (awaiting Owner approval)" : invoice.status,
    revision: invoice.revision,
    customer: { id: invoice.customer.id, name: untrusted(invoice.customer.name, 100) },
    currency: c,
    line_items: invoice.line_items.map((l) => ({ description: untrusted(l.description), quantity: l.quantity, unit_price: l.unit_price, amount: l.amount })),
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax: invoice.tax,
    total: invoice.total,
    total_display: show(invoice.total),
    amount_paid: invoice.amount_paid,
    amount_due: invoice.amount_due,
    amount_due_display: show(invoice.amount_due),
    ...(fromApi(invoice.overpaid, c) > 0n ? { overpaid: invoice.overpaid, overpaid_note: "More than the total was received; the merchant decides what to do with the excess (refunds are not a connector tool)." } : {}),
    due_date: invoice.due_date,
    due: dueLabel(invoice.due_date, profile),
    ...(invoice.overdue ? { overdue_by_days: overdueDays } : {}),
    payment_url: url(invoice.hosted_url, "a payment URL"),
    pdf_url: url(invoice.pdf_url, "a PDF URL"),
    ...(invoice.pdf_url ? {} : { pdf_note: "PDF invoices aren't supported by this backend yet." }),
    approval: approvalOut(ctx, invoice.approval),
    memo: invoice.memo ? untrusted(invoice.memo, 500) : null,
    payments: invoice.payments.map((p) => ({ id: p.id, amount: p.amount, currency: p.currency, status: "confirmed", paid_at: p.paid_at, evidence: p.evidence })),
    finalized_at: invoice.finalized_at,
    paid_at: invoice.paid_at,
  };
}

const compact = (invoice: Invoice, profile: Profile) => ({
  id: invoice.id,
  number: invoice.number,
  customer: untrusted(invoice.customer.name, 100),
  status: invoice.overdue ? "overdue" : invoice.status === "draft" && invoice.approval?.status === "pending" ? "awaiting approval" : invoice.status,
  total: display(fromApi(invoice.total, invoice.currency as Currency), invoice.currency as Currency),
  amount_due: display(fromApi(invoice.amount_due, invoice.currency as Currency), invoice.currency as Currency),
  due: dueLabel(invoice.due_date, profile),
});

function nextFor(invoice: Invoice): string {
  if (invoice.status === "draft") {
    return invoice.approval?.status === "pending"
      ? "Waiting for an Owner to approve this exact version on the review page. Editing the draft cancels that request."
      : "Review the line items and totals with the merchant; when they're right, call finalize_invoice to ask an Owner to approve publication.";
  }
  if (invoice.status === "paid") return "Paid in full: nothing to collect.";
  if (invoice.overdue) return "Overdue: offer prepare_invoice_reminder to draft a reminder for the merchant to send.";
  return "Share the payment URL with the customer (Whiteflow didn't send it).";
}

/** A draft as the server stored it must be the draft asked for, with totals equal to the connector's own. */
function verifyDraft(expected: { customer_id: string; due_date: string; lines: number; total: bigint }) {
  return (got: Invoice) => {
    const wrong: string[] = [];
    if (got.status !== "draft") wrong.push(`status ${got.status}`);
    if (got.customer.id !== expected.customer_id) wrong.push("a different customer");
    if (got.currency !== "USDT") wrong.push(`currency ${got.currency}`);
    if (got.due_date !== expected.due_date) wrong.push(`due date ${got.due_date}`);
    if (got.line_items.length !== expected.lines) wrong.push(`${got.line_items.length} line items`);
    if (fromApi(got.total, "USDT") !== expected.total) wrong.push(`total ${got.total} instead of ${decimal(expected.total, "USDT")}`);
    else if (recompute(got) !== expected.total) wrong.push("totals that don't add up");
    if (wrong.length) throw new Mismatch(wrong.join(", "));
  };
}

export function registerInvoiceTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "create_invoice_draft",
    {
      title: "Create invoice draft",
      description:
        "Save a private invoice DRAFT (not sent, not payable) for an existing customer_id: line items with quantity × unit price, a due date, and only an explicit discount or tax the merchant stated. " +
        "Invoices are in USDT, the settlement asset: if the merchant priced in another currency, ask for the USDT amounts or offer a payment link; never convert. Never invent a tax rate. " +
        "Resolve a relative due date (\"next Friday\") with get_business_profile's today and confirm the resulting date.",
      inputSchema: {
        customer_id: z.string().max(64).describe("From search_customers or create_customer. Never a name."),
        currency: z.string().max(8).describe('Must be "USDT".'),
        line_items: lineItems,
        due_date: z.string().describe("YYYY-MM-DD in the business time zone; today or later."),
        discount: discount.optional(),
        tax: tax.optional(),
        memo: z.string().max(500).optional().describe("Optional note shown on the invoice."),
        idempotency_key: idempotencyKey,
        create_another: createAnother,
      },
      annotations: WRITE,
    },
    (input) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        if (input.currency.toUpperCase() !== "USDT") {
          throw new ToolRefusal(`Invoices are issued in USDT, the settlement asset, and the connector never converts currencies. ${input.currency} amounts can't be used as they are.`, {
            next_action: `Ask the merchant for the USDT amounts, or offer a payment link priced in ${input.currency} (Whiteflow converts at checkout at a locked rate).`,
          });
        }
        const due = refuse(() => calendarDate(input.due_date, "due_date"));
        if (due < profile.today) throw new ToolRefusal(`due_date ${labelled(due, profile.zone)} is in the past; today is ${labelled(profile.today, profile.zone)}.`);
        const preview = refuse(() => invoiceTotals("USDT", input.line_items, input.discount ?? null, input.tax ?? null));
        const body = {
          customer_id: input.customer_id,
          currency: "USDT",
          line_items: input.line_items,
          due_date: due,
          ...(input.discount ? { discount: input.discount } : {}),
          ...(input.tax ? { tax: input.tax } : {}),
          ...(input.memo ? { memo: input.memo } : {}),
        };
        const verify = verifyDraft({ customer_id: input.customer_id, due_date: due, lines: input.line_items.length, total: preview.total });
        const written = await ctx.write("create_invoice_draft", body, { key: input.idempotency_key, createAnother: input.create_another }, (key) => ctx.client.createInvoice(body, key), verify);
        const { data, replayed } = written;
        return {
          summary: `${replayed ? "Found the draft already created" : "Saved a draft invoice"} for ${untrusted(data.customer.name, 100)}: ${display(preview.total, "USDT")}, due ${dueLabel(due, profile)}. Not sent and not payable yet.`,
          invoice: invoiceOut(ctx, data, profile),
          replayed,
          ...(replayed ? { note: replayNote(written, "draft") } : {}),
          next_action: nextFor(data),
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "update_invoice_draft",
    {
      title: "Update invoice draft",
      description:
        "Change a DRAFT before publication: customer, line items, due date, discount, tax or memo (give only what changes; `discount: null` / `tax: null` removes one). " +
        "It creates a new revision, and any pending publication approval for the old one is cancelled. Published invoices can't be edited.",
      inputSchema: {
        invoice: invoiceRef,
        customer_id: z.string().max(64).optional(),
        line_items: lineItems.optional(),
        due_date: z.string().optional(),
        discount: discount.nullable().optional(),
        tax: tax.nullable().optional(),
        memo: z.string().max(500).nullable().optional(),
        idempotency_key: idempotencyKey,
      },
      annotations: WRITE,
    },
    (input) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        const { data: current } = await ctx.client.getInvoice(checkRef(input.invoice));
        if (current.status !== "draft") throw new ToolRefusal(`Invoice ${current.number} is ${current.status}; only a draft can be edited.`);
        const lines = input.line_items ?? current.line_items.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price }));
        const due = input.due_date ? refuse(() => calendarDate(input.due_date!, "due_date")) : current.due_date;
        if (due < profile.today) throw new ToolRefusal(`due_date ${labelled(due, profile.zone)} is in the past; today is ${labelled(profile.today, profile.zone)}.`);
        const currentDiscount: DiscountInput | null = current.discount ? (current.discount.type === "percent" ? { type: "percent", percent: current.discount.percent ?? "0" } : { type: "amount", amount: current.discount.amount }) : null;
        const discountIn = input.discount === undefined ? currentDiscount : input.discount;
        const taxIn = input.tax === undefined ? (current.tax ? { name: current.tax.name, rate_percent: current.tax.rate_percent } : null) : input.tax;
        const preview = refuse(() => invoiceTotals("USDT", lines, discountIn, taxIn));
        const customerId = input.customer_id ?? current.customer.id;
        const body = {
          revision: current.revision, // the server refuses if someone changed the draft since it was read
          customer_id: customerId,
          line_items: lines,
          due_date: due,
          discount: discountIn,
          tax: taxIn,
          memo: input.memo === undefined ? current.memo : input.memo,
        };
        const verify = (got: Invoice) => {
          verifyDraft({ customer_id: customerId, due_date: due, lines: lines.length, total: preview.total })(got);
          if (got.id !== current.id || got.revision <= current.revision) throw new Mismatch("the update didn't produce a new revision of this draft");
        };
        const written = await ctx.write("update_invoice_draft", { invoice: current.id, ...body }, { key: input.idempotency_key }, (key) => ctx.client.updateInvoice(current.id, body, key), verify);
        const cancelled = current.approval?.status === "pending";
        return {
          summary: `Updated draft ${current.id} to revision ${written.data.revision}: ${display(preview.total, "USDT")}, due ${dueLabel(due, profile)}.${cancelled ? " The pending approval request for the old version was cancelled." : ""}`,
          invoice: invoiceOut(ctx, written.data, profile),
          next_action: nextFor(written.data),
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "finalize_invoice",
    {
      title: "Request invoice publication",
      description:
        "Ask to publish a reviewed DRAFT. This doesn't publish by itself: Whiteflow creates an approval request for this exact version (total, currency, customer), and an Owner of the business approves it on the review page; then the invoice gets its number and payment URL. " +
        "A conversation 'yes' is not that approval. The connector re-checks the totals first and refuses if they don't add up. Nothing is emailed or sent.",
      inputSchema: { invoice: invoiceRef, idempotency_key: idempotencyKey },
      annotations: WRITE,
    },
    ({ invoice, idempotency_key }) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        const { data: draft } = await ctx.client.getInvoice(checkRef(invoice));
        if (draft.status !== "draft") {
          return { summary: `Invoice ${draft.number} is already ${draft.status}.`, invoice: invoiceOut(ctx, draft, profile), next_action: nextFor(draft), data_notice: DATA_NOTICE };
        }
        // F4: a total that doesn't add up blocks publication; it's never just a warning
        const total = refuse(() => recompute(draft));
        if (fromApi(draft.total, "USDT") !== total) {
          throw new ToolRefusal(`This draft's total (${draft.total}) doesn't match its own line items, discount and tax (${decimal(total, "USDT")}). It can't be published; fix it with update_invoice_draft or check it in the dashboard.`, { outcome: "blocked" });
        }
        const verify = (got: { status: string; approval: Approval | null; invoice: Invoice }) => {
          const wrong: string[] = [];
          if (got.invoice.id !== draft.id) wrong.push("a different invoice");
          if (fromApi(got.invoice.total, "USDT") !== total) wrong.push(`total ${got.invoice.total}`);
          if (got.status === "approval_required") {
            const a = got.approval;
            if (!a || a.invoice_id !== draft.id || a.revision !== draft.revision || fromApi(a.total, "USDT") !== total || a.currency !== draft.currency || a.customer_id !== draft.customer.id) wrong.push("an approval request for different terms");
            else ctx.trustedUrl(a.review_url, "the review URL");
          }
          if (wrong.length) throw new Mismatch(wrong.join(", "));
        };
        const written = await ctx.write("finalize_invoice", { invoice: draft.id, revision: draft.revision }, { key: idempotency_key }, (key) => ctx.client.finalizeInvoice(draft.id, { revision: draft.revision }, key), verify);
        const { data } = written;
        if (data.status === "approval_required") {
          const approval = approvalOut(ctx, data.approval)!;
          return {
            summary: `Publication of ${display(total, "USDT")} for ${untrusted(draft.customer.name, 100)} (draft revision ${draft.revision}) is waiting for an Owner's approval. Not published yet; nothing was sent.`,
            approval,
            invoice: invoiceOut(ctx, data.invoice, profile),
            next_action:
              ctx.mode === "sandbox"
                ? `Ask the business Owner to approve it. SANDBOX: the review page is simulated by \`npm run sandbox -- approve ${approval.id}\` (a person runs it). Then get_invoice gives the number and payment URL.`
                : `Ask the business Owner to approve it at ${approval.review_url}. Then get_invoice gives the number and payment URL.`,
            data_notice: DATA_NOTICE,
          };
        }
        return {
          summary: `Invoice ${data.invoice.number} for ${untrusted(data.invoice.customer.name, 100)} is open: ${display(total, "USDT")}, due ${dueLabel(data.invoice.due_date, profile)}.`,
          invoice: invoiceOut(ctx, data.invoice, profile),
          delivered: false,
          delivery_note: "Whiteflow did not email or send this invoice. Share the payment URL with the customer yourself.",
          ...(written.replayed ? { note: replayNote(written, "finalized invoice") } : {}),
          next_action: nextFor(data.invoice),
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get invoice",
      description: "An invoice's status (draft, awaiting approval, open, overdue, paid), totals, amount paid and still due, due date, payment URL, and its verified payments. Paid status comes only from Whiteflow's verified payment records.",
      inputSchema: { invoice: invoiceRef },
      annotations: READ,
    },
    ({ invoice }) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        const ref = checkRef(invoice);
        const { data } = await ctx.client.getInvoice(ref);
        if (data.id !== ref && data.number?.toUpperCase() !== ref.toUpperCase()) throw new ToolRefusal("Whiteflow returned a different invoice than the one asked for; check it in the dashboard.");
        const out = invoiceOut(ctx, data, profile);
        return {
          summary: `${data.number ?? "Draft " + data.id} for ${out.customer.name}: ${out.status}; ${out.total_display} total, ${out.amount_due_display} due, due ${out.due}.`,
          invoice: out,
          next_action: nextFor(data),
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List invoices",
      description: "Invoices newest first, filtered by customer, status (draft, open, paid, overdue) and due-date range, with a cursor for the next page. Amounts stay in each invoice's own currency.",
      inputSchema: {
        customer_id: z.string().max(64).optional(),
        status: z.enum(["draft", "open", "paid", "overdue"]).optional(),
        due_from: z.string().optional().describe("YYYY-MM-DD, inclusive."),
        due_to: z.string().optional().describe("YYYY-MM-DD, inclusive."),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().max(40).optional().describe("The `next_cursor` of the previous page."),
      },
      annotations: READ,
    },
    (input) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        refuse(() => {
          if (input.due_from) calendarDate(input.due_from, "due_from");
          if (input.due_to) calendarDate(input.due_to, "due_to");
        });
        const { data } = await ctx.client.listInvoices({ customer_id: input.customer_id, status: input.status, due_from: input.due_from, due_to: input.due_to, limit: input.limit, cursor: input.cursor });
        const due = new Map<string, bigint>();
        for (const i of data.data) if (i.status === "open") due.set(i.currency, (due.get(i.currency) ?? 0n) + fromApi(i.amount_due, i.currency as Currency));
        return {
          summary: `${data.data.length} invoice(s)${input.status ? ` (${input.status})` : ""}${data.next ? "; more on the next page" : ""}.`,
          invoices: data.data.map((i) => compact(i, profile)),
          due_on_this_page: Object.fromEntries([...due].map(([c, units]) => [c, display(units, c as Currency)])),
          complete: data.next === null,
          next_cursor: data.next,
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "prepare_invoice_reminder",
    {
      title: "Prepare invoice reminder",
      description: "Draft a payment reminder for an open invoice: subject, body, the intended recipient and the payment URL. It does NOT send anything (sent: false); the merchant reviews and sends it.",
      inputSchema: { invoice: invoiceRef },
      annotations: READ,
    },
    ({ invoice }) =>
      ctx.reply(async () => {
        await ctx.require("reminders", "Reminder drafts");
        const { data } = await ctx.client.reminderDraft(checkRef(invoice));
        let paymentUrl: string;
        try {
          paymentUrl = ctx.trustedUrl(data.payment_url, "the payment URL");
          // every link in the text the merchant would send must be on a trusted origin too
          for (const found of data.body.match(/https?:\/\/[^\s<>"')]+/g) ?? []) ctx.trustedUrl(found, "a URL in the reminder text");
        } catch (error) {
          if (error instanceof Mismatch) throw new ToolRefusal(`The reminder's payment URL isn't on a trusted Whiteflow origin (${error.message}). Don't send it.`);
          throw error;
        }
        return {
          summary: `Drafted a reminder for ${data.number} to ${untrusted(data.recipient.name, 100)}${data.recipient.email ? ` <${untrusted(data.recipient.email, 254)}>` : " (no email on file)"}. Not sent.`,
          sent: false,
          recipient: { customer_id: data.recipient.customer_id, name: untrusted(data.recipient.name, 100), email: data.recipient.email ? untrusted(data.recipient.email, 254) : null },
          subject: untrusted(data.subject, 200),
          body: untrusted(data.body, 2_000),
          payment_url: paymentUrl,
          next_action: data.recipient.email
            ? "Show the draft to the merchant to review and send themselves. Whiteflow doesn't send reminders yet; when it does, sending will need an approval the server checks."
            : "There's no email on file for this customer: the merchant sends it through their own channel.",
          data_notice: DATA_NOTICE,
        };
      }),
  );
}
