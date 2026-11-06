// create_invoice_draft, finalize_invoice, get_invoice, list_invoices, prepare_invoice_reminder (batch 052, FR-MCP-14,
// FR-MCP-17). Totals are integer arithmetic (src/money.ts) and the server's totals must equal the connector's preview,
// or the tool says so. Finalizing sends nothing to anyone; a reminder is only ever a draft (sent: false).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Invoice } from "../contract.ts";
import { DateError, calendarDate, daysBetween, labelled } from "../dates.ts";
import { MoneyError, decimal, display, fromApi, invoiceTotals, type Currency } from "../money.ts";
import { DATA_NOTICE, ToolRefusal, untrusted } from "../safety.ts";
import { idempotencyKey } from "./business.ts";
import { dueLabel, replayNote, type Ctx, type Profile } from "./context.ts";

const REF = /^(inv_[A-Za-z0-9_-]{1,40}|WF-\d{1,9})$/i;
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

const invoiceRef = z.string().max(64).describe("The invoice id (inv_…) or its number (WF-1042).");

function checkRef(ref: string): string {
  if (!REF.test(ref)) throw new ToolRefusal("Give an invoice number like WF-1042 or an id like inv_…; use list_invoices to find it.");
  return ref;
}

function invoiceOut(invoice: Invoice, profile: Profile) {
  const c = invoice.currency as Currency;
  const show = (text: string) => display(fromApi(text, c), c);
  const overdueDays = invoice.overdue ? daysBetween(invoice.due_date, profile.today) : 0;
  return {
    id: invoice.id,
    number: invoice.number,
    status: invoice.overdue ? "open (overdue)" : invoice.status,
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
    payment_url: invoice.hosted_url,
    pdf_url: invoice.pdf_url,
    ...(invoice.pdf_url ? {} : { pdf_note: "PDF invoices aren't supported by this backend yet." }),
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
  status: invoice.overdue ? "overdue" : invoice.status,
  total: display(fromApi(invoice.total, invoice.currency as Currency), invoice.currency as Currency),
  amount_due: display(fromApi(invoice.amount_due, invoice.currency as Currency), invoice.currency as Currency),
  due: dueLabel(invoice.due_date, profile),
});

const nextFor = (invoice: Invoice) =>
  invoice.status === "draft"
    ? "Review the line items and totals with the merchant; when they approve, call finalize_invoice to get the payment URL."
    : invoice.status === "paid"
      ? "Paid in full: nothing to collect."
      : invoice.overdue
        ? "Overdue: offer prepare_invoice_reminder to draft a reminder for the merchant to send."
        : "Share the payment URL with the customer (WhiteFlow didn't send it).";

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
        line_items: z
          .array(
            z.object({
              description: z.string().min(1).max(200),
              quantity: z.number().int().min(1).max(10_000),
              unit_price: z.string().max(30).describe('Decimal string, e.g. "2000.00".'),
            }),
          )
          .min(1)
          .max(50),
        due_date: z.string().describe("YYYY-MM-DD in the business time zone; today or later."),
        discount: z
          .union([z.object({ type: z.literal("amount"), amount: z.string().max(30) }), z.object({ type: z.literal("percent"), percent: z.string().max(6) })])
          .optional()
          .describe("Only if the merchant asked for one."),
        tax: z.object({ name: z.string().min(1).max(40), rate_percent: z.string().max(6) }).optional().describe("Only a tax the merchant explicitly named, with its rate. Never infer one."),
        memo: z.string().max(500).optional().describe("Optional note shown on the invoice."),
        idempotency_key: idempotencyKey,
      },
      annotations: WRITE,
    },
    (input) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        if (input.currency.toUpperCase() !== "USDT") {
          throw new ToolRefusal(`Invoices are issued in USDT, the settlement asset, and the connector never converts currencies. ${input.currency} amounts can't be used as they are.`, {
            next_action: `Ask the merchant for the USDT amounts, or offer a payment link priced in ${input.currency} (WhiteFlow converts at checkout at a locked rate).`,
          });
        }
        let due: string;
        try {
          due = calendarDate(input.due_date, "due_date");
        } catch (error) {
          if (error instanceof DateError) throw new ToolRefusal(error.message);
          throw error;
        }
        if (due < profile.today) throw new ToolRefusal(`due_date ${labelled(due, profile.zone)} is in the past; today is ${labelled(profile.today, profile.zone)}.`);
        let preview;
        try {
          preview = invoiceTotals("USDT", input.line_items, input.discount ?? null, input.tax ?? null);
        } catch (error) {
          if (error instanceof MoneyError) throw new ToolRefusal(error.message);
          throw error;
        }
        const body = {
          customer_id: input.customer_id,
          currency: "USDT",
          line_items: input.line_items,
          due_date: due,
          ...(input.discount ? { discount: input.discount } : {}),
          ...(input.tax ? { tax: input.tax } : {}),
          ...(input.memo ? { memo: input.memo } : {}),
        };
        const { data, replayed, recovered } = await ctx.write("create_invoice_draft", body, input.idempotency_key, (key) => ctx.client.createInvoice(body, key));
        const mismatch = fromApi(data.total, "USDT") !== preview.total;
        return {
          summary: `${replayed ? "Found the draft already created" : "Saved a draft invoice"} for ${untrusted(data.customer.name, 100)}: ${display(preview.total, "USDT")}, due ${dueLabel(due, profile)}. Not sent and not payable yet.`,
          invoice: invoiceOut(data, profile),
          ...(mismatch ? { warning: `WhiteFlow's total (${data.total}) differs from the connector's preview (${decimal(preview.total, "USDT")}). Don't finalize; report this.` } : {}),
          replayed,
          ...(replayed ? { note: replayNote(replayed, recovered, "draft") } : {}),
          next_action: nextFor(data),
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "finalize_invoice",
    {
      title: "Finalize invoice",
      description:
        "Turn a reviewed DRAFT into an open invoice: assigns its number and returns the hosted payment URL (and a PDF URL where supported). Only after the merchant approved the draft's totals. It does NOT email or send anything.",
      inputSchema: { invoice: invoiceRef, idempotency_key: idempotencyKey },
      annotations: WRITE,
    },
    ({ invoice, idempotency_key }) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        const ref = checkRef(invoice);
        const { data, replayed, recovered } = await ctx.write("finalize_invoice", { invoice: ref }, idempotency_key, (key) => ctx.client.finalizeInvoice(ref, key));
        return {
          summary: `Invoice ${data.number} for ${untrusted(data.customer.name, 100)} is open: ${display(fromApi(data.total, data.currency as Currency), data.currency as Currency)}, due ${dueLabel(data.due_date, profile)}.`,
          invoice: invoiceOut(data, profile),
          delivered: false,
          delivery_note: "WhiteFlow did not email or send this invoice. Share the payment URL with the customer yourself.",
          replayed,
          ...(replayed ? { note: replayNote(replayed, recovered, "finalized invoice") } : {}),
          next_action: `Send ${data.hosted_url} to the customer. Ask "has ${data.number} been paid?" later.`,
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "get_invoice",
    {
      title: "Get invoice",
      description: "An invoice's status (draft, open, overdue, paid), totals, amount paid and still due, due date, payment URL, and its verified payments. Paid status comes only from WhiteFlow's verified payment records.",
      inputSchema: { invoice: invoiceRef },
      annotations: READ,
    },
    ({ invoice }) =>
      ctx.reply(async () => {
        const profile = await ctx.require("invoices", "Invoices");
        const { data } = await ctx.client.getInvoice(checkRef(invoice));
        const out = invoiceOut(data, profile);
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
        try {
          if (input.due_from) calendarDate(input.due_from, "due_from");
          if (input.due_to) calendarDate(input.due_to, "due_to");
        } catch (error) {
          if (error instanceof DateError) throw new ToolRefusal(error.message);
          throw error;
        }
        const { data } = await ctx.client.listInvoices({ customer_id: input.customer_id, status: input.status, due_from: input.due_from, due_to: input.due_to, limit: input.limit, cursor: input.cursor });
        const due = new Map<string, bigint>();
        for (const i of data.data) if (i.status === "open") due.set(i.currency, (due.get(i.currency) ?? 0n) + fromApi(i.amount_due, i.currency as Currency));
        return {
          summary: `${data.data.length} invoice(s)${input.status ? ` (${input.status})` : ""}${data.next ? "; more on the next page" : ""}.`,
          invoices: data.data.map((i) => compact(i, profile)),
          due_on_this_page: Object.fromEntries([...due].map(([c, units]) => [c, display(units, c as Currency)])),
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
        return {
          summary: `Drafted a reminder for ${data.number} to ${untrusted(data.recipient.name, 100)}${data.recipient.email ? ` <${untrusted(data.recipient.email, 254)}>` : " (no email on file)"}. Not sent.`,
          sent: false,
          recipient: { customer_id: data.recipient.customer_id, name: untrusted(data.recipient.name, 100), email: data.recipient.email ? untrusted(data.recipient.email, 254) : null },
          subject: untrusted(data.subject, 200),
          body: untrusted(data.body, 2_000),
          payment_url: data.payment_url,
          next_action: data.recipient.email
            ? "Show the draft to the merchant to review and send themselves. WhiteFlow doesn't send reminders yet; when it does, sending will need an approval the server checks."
            : "There's no email on file for this customer: the merchant sends it through their own channel.",
          data_notice: DATA_NOTICE,
        };
      }),
  );
}
