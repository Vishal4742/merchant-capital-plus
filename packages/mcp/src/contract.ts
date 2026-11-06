// The WhiteFlow merchant API contract the connector speaks (batch 052; API-CONTRACT.md is the prose version).
// LIVE = served by apps/web on main today (testnet). PROPOSED = not on the web backend yet (W3); the sandbox adapter
// (src/sandbox) serves every route, live shapes included, so one client and one set of tools cover both.
//
//   GET  /api/v1/account                          LIVE      account:read
//   GET  /api/v1/customers?query&limit            PROPOSED  customers:read
//   POST /api/v1/customers                        PROPOSED  customers:write   Idempotency-Key required
//   POST /api/v1/links                            LIVE      links:write       Idempotency-Key (optional live, sent always)
//   GET  /api/v1/links/{id}                       LIVE      links:read
//   POST /api/v1/invoices                         PROPOSED  invoices:write    Idempotency-Key required (a draft)
//   POST /api/v1/invoices/{id}/finalize           PROPOSED  invoices:write    Idempotency-Key required
//   GET  /api/v1/invoices/{id|number}             PROPOSED  invoices:read
//   GET  /api/v1/invoices?customer_id&status&due_from&due_to&limit&cursor   PROPOSED  invoices:read
//   GET  /api/v1/invoices/{id}/reminder-draft     PROPOSED  invoices:read     never sends
//   GET  /api/v1/receivables                      PROPOSED  invoices:read     outstanding and overdue by currency
//   GET  /api/v1/payments?limit&cursor            LIVE      payments:read     verified payments only
//   GET  /api/v1/reports?from&to&tz               LIVE      reports:read
//
// Every route: `Authorization: Bearer <key>`; the merchant comes from the key, never from a parameter; another
// merchant's id answers 404. Errors: `{ "error": "<plain reason>" }` with 400/401/403/404/409/413/422/429/5xx.

export type Scope =
  | "account:read"
  | "customers:read"
  | "customers:write"
  | "links:read"
  | "links:write"
  | "invoices:read"
  | "invoices:write"
  | "payments:read"
  | "reports:read";

export interface Account {
  merchant: { address?: string; id?: string; name: string };
  environment: "test" | "sandbox";
  network: { name: string; chain_id: number; explorer: string } | null;
  settlement: { asset: "USDT"; token: string | null; decimals: number };
  price_currencies: string[];
  payment_limits: { currency: "USDT"; min: string; max: string };
  payment_methods: { id: string; label: string }[];
  timezone: string | null;
  credential: { type: string; key_id: string | null; scopes: Scope[] | null; expires_at: string | null };
  capabilities: { links: boolean; payments: boolean; reports: boolean; customers: boolean; invoices: boolean; reminders: boolean };
}

export interface Customer {
  id: string;
  name: string;
  email_masked: string | null;
  created_at: string;
}

/** 409 from POST /api/v1/customers when a likely duplicate exists and `confirm_new` wasn't true. */
export interface DuplicateCustomers {
  error: string;
  possible_duplicates: Customer[];
}

export type LinkStatus = "active" | "paid" | "expired" | "cancelled";
export interface Link {
  id: string;
  slug: string;
  url: string; // relative to the gateway origin: /l/<slug>
  amount: string | null;
  currency: string;
  description: string;
  reference_id: string | null;
  single_use: boolean;
  status: LinkStatus;
  expires_at: string | null;
  created_at: string;
  payments: number;
}
export interface LinkPayment {
  session_id: string;
  payment_id: string | null;
  amount: string;
  currency: "USDT";
  tx_hash: string | null;
  paid_at: string | null;
}
export interface LinkDetail extends Link {
  paid_checkouts: LinkPayment[];
}

export type InvoiceStatus = "draft" | "open" | "paid";
export interface InvoicePayment {
  id: string;
  amount: string;
  currency: string;
  status: "succeeded";
  paid_at: string;
  evidence: string | null; // tx hash, or the sandbox provider's reference
}
export interface Invoice {
  id: string;
  number: string | null; // WF-<n>, assigned at finalize
  status: InvoiceStatus;
  overdue: boolean; // open and the due date has passed in the business time zone
  customer: { id: string; name: string };
  currency: string;
  line_items: { description: string; quantity: number; unit_price: string; amount: string }[];
  subtotal: string;
  discount: { type: "amount" | "percent"; percent: string | null; amount: string } | null;
  tax: { name: string; rate_percent: string; amount: string } | null;
  total: string;
  amount_paid: string;
  amount_due: string;
  overpaid: string;
  due_date: string; // calendar date in `timezone`
  timezone: string;
  memo: string | null;
  hosted_url: string | null; // null until finalized
  pdf_url: string | null; // null: not supported
  created_at: string;
  finalized_at: string | null;
  paid_at: string | null;
  payments: InvoicePayment[];
}
export interface Page<T> {
  data: T[];
  next: string | null;
}

export interface Receivables {
  as_of: string;
  timezone: string;
  by_currency: Record<string, { outstanding: string; overdue: string; open_count: number; overdue_count: number }>;
}

export interface ReminderDraft {
  invoice_id: string;
  number: string;
  recipient: { customer_id: string; name: string; email: string | null };
  subject: string;
  body: string;
  payment_url: string;
  sent: false;
}

/** GET /api/v1/payments: the live shape (camelCase, as the SDK reads it). The sandbox adds linkId/invoiceNumber. */
export interface ApiPayment {
  paymentId: string;
  sessionId: string | null;
  invoiceId: string | null;
  amount: string;
  refunded: string;
  txHash: string | null;
  paidAt: string;
  reference: string;
  linkId?: string | null;
  invoiceNumber?: string | null;
}

export interface ReportTotals {
  gross: string;
  fees: string;
  net: string;
  refunds: string;
  count: number;
}
export interface Report {
  from: string;
  to: string;
  tz: string;
  days: (ReportTotals & { date: string })[];
  totals: ReportTotals;
}
