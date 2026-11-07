// The WhiteFlow merchant API contract the connector speaks (batch 052; API-CONTRACT.md is the prose version), as
// runtime schemas: every reply is parsed against these before any tool reads it (production review F3). Unknown fields
// are dropped; strings and lists are bounded, so a faulty or hostile backend can't flood the model.
// LIVE = served by apps/web on main (testnet). PROPOSED = not on the web backend yet; the sandbox serves every route.
//
//   GET  /api/v1/account                          LIVE      account:read
//   GET  /api/v1/operations/{idempotency_key}     LIVE*     account:read      the outcome of a write, by its key (*PR #48)
//   GET  /api/v1/customers?query&limit            PROPOSED  customers:read
//   POST /api/v1/customers                        PROPOSED  customers:write   Idempotency-Key
//   POST /api/v1/links                            LIVE      links:write       Idempotency-Key
//   GET  /api/v1/links/{id}                       LIVE      links:read
//   POST /api/v1/invoices                         PROPOSED  invoices:write    Idempotency-Key (a draft)
//   POST /api/v1/invoices/{id}                    PROPOSED  invoices:write    Idempotency-Key (edit a draft; supersedes approvals)
//   POST /api/v1/invoices/{id}/finalize           PROPOSED  invoices:write    Idempotency-Key (asks for Owner approval)
//   GET  /api/v1/approvals/{id}                   PROPOSED  invoices:read
//   GET  /api/v1/invoices/{id|number}             PROPOSED  invoices:read
//   GET  /api/v1/invoices?customer_id&status&due_from&due_to&limit&cursor   PROPOSED  invoices:read
//   GET  /api/v1/invoices/{id}/reminder-draft     PROPOSED  invoices:read     never sends
//   GET  /api/v1/receivables                      PROPOSED  invoices:read
//   GET  /api/v1/payments?limit&cursor            LIVE      payments:read     verified payments only
//   GET  /api/v1/reports?from&to&tz               LIVE      reports:read
import { z } from "zod";

export type Scope = "account:read" | "customers:read" | "customers:write" | "links:read" | "links:write" | "invoices:read" | "invoices:write" | "payments:read" | "reports:read";

const text = (max: number) => z.string().max(max);
const decimalText = z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/, "a decimal amount");
const time = z.string().max(40);
const id = z.string().regex(/^[\w-]{1,80}$/);

export const AccountSchema = z.object({
  merchant: z.object({ address: text(64).optional(), id: text(80).optional(), name: text(200) }),
  environment: z.enum(["test", "sandbox"]),
  network: z.object({ name: text(100), chain_id: z.number().int(), explorer: text(200) }).nullable(),
  settlement: z.object({ asset: z.literal("USDT"), token: text(64).nullable(), decimals: z.number().int() }),
  price_currencies: z.array(text(8)).max(50),
  payment_limits: z.object({ currency: z.literal("USDT"), min: decimalText, max: decimalText }),
  payment_methods: z.array(z.object({ id: text(64), label: text(300) })).max(20),
  timezone: text(64).nullable(),
  credential: z.object({ type: text(40), key_id: text(80).nullable(), scopes: z.array(text(40)).max(50).nullable(), expires_at: time.nullable() }),
  capabilities: z.object({
    links: z.boolean(),
    payments: z.boolean(),
    reports: z.boolean(),
    customers: z.boolean(),
    invoices: z.boolean(),
    reminders: z.boolean(),
    operations: z.boolean().optional(),
    approvals: z.boolean().optional(),
  }),
  publish_policy: z.enum(["owner_approval"]).optional(),
});
export type Account = z.infer<typeof AccountSchema>;

export const OperationSchema = z.object({
  idempotency_key: text(255),
  route: text(80),
  state: z.enum(["succeeded", "pending"]), // pending: in flight, or left by a request that died (<5 min)
  http_status: z.number().int().nullable(),
  result_id: text(80).nullable(),
  created_at: time,
});
export type Operation = z.infer<typeof OperationSchema>;

export const CustomerSchema = z.object({ id, name: text(200), email_masked: text(300).nullable(), created_at: time });
export type Customer = z.infer<typeof CustomerSchema>;
export const DuplicateCustomersSchema = z.object({ error: text(500), possible_duplicates: z.array(CustomerSchema).max(50) });

export const LinkSchema = z.object({
  id,
  slug: text(64),
  url: text(500),
  amount: decimalText.nullable(),
  currency: text(8),
  description: text(400),
  reference_id: text(80).nullable(),
  customer_id: id.nullable().optional(), // sandbox only
  single_use: z.boolean(),
  status: z.enum(["active", "paid", "expired", "cancelled"]),
  expires_at: time.nullable(),
  created_at: time,
  payments: z.number().int().min(0),
});
export type Link = z.infer<typeof LinkSchema>;
export const LinkDetailSchema = LinkSchema.extend({
  paid_checkouts: z
    .array(z.object({ session_id: text(80), payment_id: text(80).nullable(), amount: decimalText, currency: z.literal("USDT"), tx_hash: text(80).nullable(), paid_at: time.nullable() }))
    .max(200),
});
export type LinkDetail = z.infer<typeof LinkDetailSchema>;

export const ApprovalSchema = z.object({
  id,
  invoice_id: id,
  revision: z.number().int().min(1),
  status: z.enum(["pending", "approved", "rejected", "superseded", "expired"]),
  total: decimalText,
  currency: text(8),
  customer_id: id,
  requested_at: time,
  expires_at: time,
  decided_at: time.nullable(),
  review_url: text(500),
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const InvoiceSchema = z.object({
  id,
  number: text(40).nullable(),
  status: z.enum(["draft", "open", "paid"]),
  revision: z.number().int().min(1),
  overdue: z.boolean(),
  customer: z.object({ id, name: text(200) }),
  currency: text(8),
  line_items: z.array(z.object({ description: text(400), quantity: z.number().int().min(1), unit_price: decimalText, amount: decimalText })).min(1).max(100),
  subtotal: decimalText,
  discount: z.object({ type: z.enum(["amount", "percent"]), percent: text(8).nullable(), amount: decimalText }).nullable(),
  tax: z.object({ name: text(80), rate_percent: text(8), amount: decimalText }).nullable(),
  total: decimalText,
  amount_paid: decimalText,
  amount_due: decimalText,
  overpaid: decimalText,
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: text(64),
  memo: text(1000).nullable(),
  hosted_url: text(500).nullable(),
  pdf_url: text(500).nullable(),
  created_at: time,
  finalized_at: time.nullable(),
  paid_at: time.nullable(),
  approval: ApprovalSchema.nullable(),
  payments: z.array(z.object({ id: text(80), amount: decimalText, currency: text(8), status: z.literal("succeeded"), paid_at: time, evidence: text(200).nullable() })).max(500),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** POST /api/v1/invoices/{id}/finalize: an approval request (202) under the Owner-approval policy, or the open invoice. */
export const FinalizeSchema = z.object({ status: z.enum(["approval_required", "open"]), approval: ApprovalSchema.nullable(), invoice: InvoiceSchema });
export type Finalize = z.infer<typeof FinalizeSchema>;

export const pageOf = <T extends z.ZodTypeAny>(item: T, max: number) => z.object({ data: z.array(item).max(max), next: text(80).nullable() });
export type Page<T> = { data: T[]; next: string | null };

export const ReceivablesSchema = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: text(64),
  by_currency: z.record(text(8), z.object({ outstanding: decimalText, overdue: decimalText, open_count: z.number().int(), overdue_count: z.number().int() })),
});
export type Receivables = z.infer<typeof ReceivablesSchema>;

export const ReminderSchema = z.object({
  invoice_id: id,
  number: text(40),
  recipient: z.object({ customer_id: id, name: text(200), email: text(300).nullable() }),
  subject: text(300),
  body: text(4000),
  payment_url: text(500),
  sent: z.literal(false),
});
export type ReminderDraft = z.infer<typeof ReminderSchema>;

export const ApiPaymentSchema = z.object({
  paymentId: text(80),
  sessionId: text(80).nullable(),
  invoiceId: text(80).nullable(),
  amount: decimalText,
  refunded: decimalText,
  txHash: text(80).nullable(),
  paidAt: time,
  reference: text(200),
  linkId: text(80).nullable().optional(),
  invoiceNumber: text(40).nullable().optional(),
});
export type ApiPayment = z.infer<typeof ApiPaymentSchema>;

const totals = z.object({ gross: decimalText, fees: decimalText, net: decimalText, refunds: decimalText, count: z.number().int().min(0) });
export const ReportSchema = z.object({ from: text(10), to: text(10), tz: text(64), days: z.array(totals.extend({ date: text(10) })).max(100), totals });
export type Report = z.infer<typeof ReportSchema>;
export type ReportTotals = z.infer<typeof totals>;
