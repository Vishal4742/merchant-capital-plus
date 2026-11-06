// The sandbox demo end to end (batch 052 acceptance): find or create a customer → draft → finalize → payment URL →
// a simulated, signed provider payment → the invoice is paid by the backend's processing → it shows in the collection
// summary. Plus the lifecycle's refusals. Offline: the sandbox is in-process. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { simulatePayment } from "../src/sandbox/provider.ts";
import { NOW, approveAs, publish, sandbox } from "./helpers.ts";

const LINES = [{ description: "Consulting session", quantity: 3, unit_price: "20.00" }];

async function customer(call: Awaited<ReturnType<typeof sandbox>>["call"], name = "Priya Sharma", email = "priya@example.com") {
  const created = await call("create_customer", { name, email });
  assert.equal(created.isError, false, created.text);
  return created.json.customer.id as string;
}

test("demo: customer → draft → finalize → URL → simulated signed payment → paid → in the summary", async () => {
  const { call, stateDir } = await sandbox();

  const profile = await call("get_business_profile");
  assert.equal(profile.json.environment, "sandbox");
  assert.match(profile.json.environment_note, /SANDBOX/);
  assert.equal(profile.json.timezone.zone, "Asia/Kolkata");
  assert.equal(profile.json.timezone.today, "Friday 2026-11-06 (Asia/Kolkata)");
  assert.deepEqual(profile.json.invoice_currencies, ["USDT"]);

  // 1. find or create the customer
  assert.deepEqual((await call("search_customers", { query: "Priya" })).json.customers, []);
  const priya = await customer(call);
  const found = await call("search_customers", { query: "priya" });
  assert.deepEqual(found.json.customers, [{ id: priya, name: "Priya Sharma", email: "p***@example.com" }]);

  // 2. draft (three sessions at 20 USDT, due next Friday) and finalize
  const draft = await call("create_invoice_draft", { customer_id: priya, currency: "USDT", line_items: LINES, due_date: "2026-11-13" });
  assert.equal(draft.isError, false, draft.text);
  assert.equal(draft.json.invoice.status, "draft");
  assert.equal(draft.json.invoice.total, "60.00");
  assert.equal(draft.json.invoice.due, "Friday 2026-11-13 (Asia/Kolkata)");
  assert.equal(draft.json.invoice.payment_url, null);
  assert.match(draft.json.summary, /Not sent and not payable yet/);

  // finalize only ASKS to publish; the business Owner approves this exact version (sandbox: the CLI, a person)
  const requested = await call("finalize_invoice", { invoice: draft.json.invoice.id });
  assert.equal(requested.isError, false, requested.text);
  assert.equal(requested.json.approval.status, "pending");
  assert.equal(requested.json.approval.total, "60.00");
  assert.equal(requested.json.invoice.status, "draft (awaiting Owner approval)");
  assert.equal(requested.json.invoice.payment_url, null);
  assert.match(requested.json.summary, /waiting for an Owner's approval\. Not published yet; nothing was sent/);
  assert.match(requested.json.next_action, /npm run sandbox -- approve apr_/);
  assert.equal(approveAs(stateDir, requested.json.approval.id).code, 0);
  const final = await call("get_invoice", { invoice: draft.json.invoice.id });
  assert.equal(final.json.invoice.number, "WF-1001");
  assert.equal(final.json.invoice.status, "open");
  assert.equal(final.json.invoice.approval.status, "approved");
  assert.equal(final.json.invoice.pdf_url, null);
  // 3. the payment URL
  assert.match(final.json.invoice.payment_url, /^https:\/\/sandbox\.whiteflow\.invalid\/i\/inv_/);

  // 4. the customer pays: the simulated provider sends signed events (a person runs this, never a tool)
  const paid = simulatePayment(stateDir, "WF-1001", {}, () => NOW + 60_000);
  assert.deepEqual(paid.deliveries.map((d) => d.outcome), ["applied", "applied"]);

  // 5. the backend's processing marked it paid
  const after = await call("get_invoice", { invoice: "WF-1001" });
  assert.equal(after.json.invoice.status, "paid");
  assert.equal(after.json.invoice.amount_due, "0.00");
  assert.equal(after.json.invoice.payments.length, 1);
  assert.match(after.json.invoice.payments[0].evidence, /^sandbox:/);

  // 6. and the collection summary shows it
  const summary = await call("get_collection_summary", { period: "this_week" });
  assert.equal(summary.isError, false, summary.text);
  assert.deepEqual(summary.json.range, { from: "2026-11-02", to: "2026-11-06", timezone: "Asia/Kolkata" });
  assert.equal(summary.json.collected.USDT.gross, "60.00 USDT");
  assert.equal(summary.json.collected.USDT.payments, 1);
  assert.deepEqual(summary.json.receivables_now, {});
  const payments = await call("list_payments", {});
  assert.equal(payments.json.payments[0].related.invoice, "WF-1001");
  assert.equal(payments.json.payments[0].amount, "60.00");
});

test("discount and explicit tax: integer math, one half-up rounding each, shown on the draft", async () => {
  const { call } = await sandbox();
  const id = await customer(call, "Acme Ltd");
  const draft = await call("create_invoice_draft", {
    customer_id: id,
    currency: "USDT",
    line_items: [
      { description: "Design", quantity: 1, unit_price: "333.33" },
      { description: "Hosting", quantity: 3, unit_price: "0.10" },
    ],
    due_date: "2026-11-30",
    discount: { type: "percent", percent: "12.5" },
    tax: { name: "GST", rate_percent: "18" },
  });
  assert.equal(draft.isError, false, draft.text);
  const inv = draft.json.invoice;
  // subtotal 333.63; 12.5% = 41.70375 → 41.703750 (USDT has 6 decimals: exact); taxable 291.92625; 18% = 52.546725
  assert.equal(inv.subtotal, "333.63");
  assert.equal(inv.discount.amount, "41.70375");
  assert.equal(inv.tax.amount, "52.546725");
  assert.equal(inv.total, "344.472975");
  assert.equal(draft.json.warning, undefined); // the server's total equals the connector's preview
});

test("lifecycle refusals: non-USDT invoice, past due date, too precise, names instead of ids, finalize twice", async () => {
  const { call, stateDir } = await sandbox();
  const id = await customer(call);
  const inr = await call("create_invoice_draft", { customer_id: id, currency: "INR", line_items: [{ description: "Session", quantity: 3, unit_price: "2000" }], due_date: "2026-11-13" });
  assert.equal(inr.isError, true);
  assert.match(inr.json.error, /USDT/);
  assert.match(inr.json.next_action, /payment link priced in INR/);
  const past = await call("create_invoice_draft", { customer_id: id, currency: "USDT", line_items: LINES, due_date: "2026-11-05" });
  assert.match(past.json.error, /in the past; today is Friday 2026-11-06/);
  const precise = await call("create_invoice_draft", { customer_id: id, currency: "USDT", line_items: [{ description: "x", quantity: 1, unit_price: "1.0000001" }], due_date: "2026-11-13" });
  assert.match(precise.json.error, /7 decimals, but USDT has 6/);
  const byName = await call("create_invoice_draft", { customer_id: "Priya Sharma", currency: "USDT", line_items: LINES, due_date: "2026-11-13" });
  assert.equal(byName.isError, true);
  assert.match(byName.json.error, /No such customer/);
  const impossible = await call("create_invoice_draft", { customer_id: id, currency: "USDT", line_items: LINES, due_date: "2026-02-30" });
  assert.match(impossible.json.error, /calendar date/);
  const big = await call("create_invoice_draft", { customer_id: id, currency: "USDT", line_items: [{ description: "x", quantity: 2, unit_price: "600" }], due_date: "2026-11-13" });
  assert.match(big.json.error, /between 1 and 1,000 USDT/);

  const draft = await call("create_invoice_draft", { customer_id: id, currency: "USDT", line_items: LINES, due_date: "2026-11-13" });
  await publish(call, stateDir, draft.json.invoice.id);
  // a second, separate finalize (new key) of the published invoice changes nothing: never a second number
  const again = await call("finalize_invoice", { invoice: draft.json.invoice.id, idempotency_key: "deliberate-second-finalize" });
  assert.match(again.json.summary, /already open/);
  assert.equal(again.json.invoice.number, "WF-1001");
  const reminderOfDraft = await call("create_invoice_draft", { customer_id: id, currency: "USDT", line_items: LINES, due_date: "2026-11-20" });
  const r = await call("prepare_invoice_reminder", { invoice: reminderOfDraft.json.invoice.id });
  assert.match(r.json.error, /still a draft/);
});

test("overdue: listed by status, totalled in the summary, and the reminder is a draft that names the right recipient", async () => {
  let clock = NOW;
  const { call, stateDir } = await sandbox({ now: () => clock });
  const id = await customer(call);
  const draft = await call("create_invoice_draft", { customer_id: id, currency: "USDT", line_items: LINES, due_date: "2026-11-07" });
  await publish(call, stateDir, draft.json.invoice.id, () => clock);
  clock = NOW + 3 * 86_400_000; // Monday 2026-11-09 in Kolkata
  const overdue = await call("list_invoices", { status: "overdue" });
  assert.equal(overdue.json.invoices.length, 1);
  assert.equal(overdue.json.invoices[0].status, "overdue");
  assert.deepEqual(overdue.json.due_on_this_page, { USDT: "60.00 USDT" });
  const got = await call("get_invoice", { invoice: "wf-1001" });
  assert.equal(got.json.invoice.overdue_by_days, 2);
  const summary = await call("get_collection_summary", { period: "today" });
  assert.deepEqual(summary.json.receivables_now, { USDT: { outstanding: "60.00 USDT", overdue: "60.00 USDT", open_invoices: 1, overdue_invoices: 1 } });
  const reminder = await call("prepare_invoice_reminder", { invoice: "WF-1001" });
  assert.equal(reminder.json.sent, false);
  assert.deepEqual(reminder.json.recipient, { customer_id: id, name: "Priya Sharma", email: "priya@example.com" });
  assert.match(reminder.json.subject, /^Overdue: invoice WF-1001/);
  assert.match(reminder.json.body, /was due on Saturday 2026-11-07 \(Asia\/Kolkata\) and is now overdue/);
  assert.match(reminder.json.body, /https:\/\/sandbox\.whiteflow\.invalid\/i\//);
});

test("customers: duplicates are listed, not created, until the merchant confirms a different customer", async () => {
  const { call } = await sandbox();
  await customer(call, "Acme Ltd", "billing@acme.example");
  const dup = await call("create_customer", { name: "ACME ltd." });
  assert.equal(dup.isError, false);
  assert.equal(dup.json.created, false);
  assert.equal(dup.json.possible_duplicates.length, 1);
  assert.equal(dup.json.possible_duplicates[0].email, "b***@acme.example");
  const byEmail = await call("create_customer", { name: "Acme Billing", email: "billing@acme.example" });
  assert.equal(byEmail.json.created, false);
  const confirmed = await call("create_customer", { name: "ACME ltd.", confirm_new: true });
  assert.match(confirmed.json.customer.id, /^cus_/);
  assert.equal((await call("search_customers", { query: "acme" })).json.customers.length, 2);
});

test("payment links in the sandbox: INR priced, single-use, paid by a simulated payment", async () => {
  const { call, stateDir } = await sandbox();
  const link = await call("create_payment_link", { amount: "15000", currency: "INR", description: "Acme website redesign" });
  assert.equal(link.isError, false, link.text);
  assert.equal(link.json.link.amount, "15000.00");
  assert.equal(link.json.link.amount_display, "₹15,000.00");
  assert.equal(link.json.link.single_use, true);
  assert.equal(link.json.delivered, false);
  assert.match(link.json.settlement_note, /Priced in INR.*converts it to USDT/);
  assert.match(link.json.link.url, /^https:\/\/sandbox\.whiteflow\.invalid\/l\//);
  // the sandbox has no exchange rates: the person simulating says what the customer paid in USDT
  assert.throws(() => simulatePayment(stateDir, link.json.link.id), /no exchange rates/);
  simulatePayment(stateDir, link.json.link.id, { amountUnits: 180_000_000n });
  const read = await call("get_payment_link", { link_id: link.json.link.id });
  assert.equal(read.json.link.status, "paid");
  assert.equal(read.json.paid, true);
  assert.equal(read.json.payments[0].amount, "180.00");
  const bad = await call("create_payment_link", { amount: "15000.505", currency: "INR", description: "x" });
  assert.match(bad.json.error, /3 decimals, but INR has 2/);
  const decimalComma = await call("create_payment_link", { amount: "1,50", currency: "EUR", description: "x" });
  assert.match(decimalComma.json.error, /dot for decimals/);
  const zero = await call("create_payment_link", { amount: "0", currency: "USDT", description: "x" });
  assert.match(zero.json.error, /more than 0/);
  const negative = await call("create_payment_link", { amount: "-5", currency: "USDT", description: "x" });
  assert.equal(negative.isError, true);
});
