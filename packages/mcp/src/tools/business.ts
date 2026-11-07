// get_business_profile, search_customers, create_customer (batch 052, FR-MCP-12, FR-MCP-13). The business comes from
// the API key only; no tool takes a merchant or business id (FR-BIZ-1: never authorize from a client-supplied id).
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "../client.ts";
import { DuplicateCustomersSchema, type Customer } from "../contract.ts";
import { labelled } from "../dates.ts";
import { INVOICE_CURRENCIES } from "../money.ts";
import { DATA_NOTICE, untrusted } from "../safety.ts";
import { IDEMPOTENCY_KEY, Mismatch, replayNote, type Ctx } from "./context.ts";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
export const idempotencyKey = z
  .string()
  .regex(IDEMPOTENCY_KEY, "8 to 100 letters, digits or _ . : -")
  .optional()
  .describe("Optional, advanced: your own key for this exact request. Leave it out normally: a retry of an unresolved request is resumed automatically.");
export const createAnother = z
  .boolean()
  .optional()
  .describe("true only when the merchant deliberately wants a second record identical to one just created (e.g. two identical sales). Never to retry an error.");

const customerOut = (c: Customer) => ({ id: c.id, name: untrusted(c.name, 100), email: c.email_masked ? untrusted(c.email_masked, 260) : null });

export function registerBusinessTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "get_business_profile",
    {
      title: "Get business profile",
      description:
        "The signed-in business: name, environment (sandbox or testnet), time zone and today's date there, supported price currencies, invoice currency, payment methods and limits, and what this API key may do. Call it first, and resolve relative dates (\"next Friday\") against its `today`.",
      inputSchema: {},
      annotations: READ,
    },
    () =>
      ctx.reply(async () => {
        const { account, zone, zoneSource, today } = await ctx.profile();
        const scopes = account.credential.scopes;
        return {
          summary: `${untrusted(account.merchant.name, 100)} · ${ctx.mode === "sandbox" ? "SANDBOX (simulated)" : "TESTNET (test USDT)"} · today is ${labelled(today, zone)}.`,
          business: { name: untrusted(account.merchant.name, 100), id: account.merchant.id ?? account.merchant.address ?? null },
          timezone: { zone, source: zoneSource, today: labelled(today, zone) },
          network: account.network,
          settlement: account.settlement,
          price_currencies: account.price_currencies,
          price_currency_note: "Links may be priced in any of these. A price that isn't USDT is converted to USDT by Whiteflow at a rate locked when the customer opens the checkout; the customer pays, and you receive, USDT.",
          invoice_currencies: account.capabilities.invoices ? [...INVOICE_CURRENCIES] : [],
          payment_methods: account.payment_methods,
          payment_limits: account.payment_limits,
          permissions: scopes ?? "This testnet key is a full merchant secret key: Whiteflow keys have no scopes yet.",
          publication: account.capabilities.invoices
            ? account.publish_policy === "owner_approval"
              ? "An Owner approves each invoice on the review page before it is published (enforced by Whiteflow)."
              : "Invoices are published as soon as they're finalized."
            : null,
          credential_expires_at: account.credential.expires_at,
          available: account.capabilities,
          next_action: account.capabilities.invoices ? "Ask what to collect: a payment link or an invoice." : "This backend supports payment links, payments and the collection summary; invoices and customers are not available yet.",
        };
      }),
  );

  server.registerTool(
    "search_customers",
    {
      title: "Search customers",
      description: "Find existing customers by name or email (part of either). Returns stable customer ids with a masked email. Use it before create_customer, and to turn a name into the customer_id an invoice needs.",
      inputSchema: {
        query: z.string().min(1).max(100).describe("Part of the customer's name or email, e.g. \"Acme\"."),
        limit: z.number().int().min(1).max(20).default(10).describe("At most this many, 1 to 20."),
      },
      annotations: READ,
    },
    ({ query, limit }) =>
      ctx.reply(async () => {
        await ctx.require("customers", "Customer search");
        const { data } = await ctx.client.searchCustomers(query, limit);
        const customers = data.data.map(customerOut);
        return {
          summary: customers.length ? `${customers.length} customer(s) match "${untrusted(query, 100)}".` : `No customer matches "${untrusted(query, 100)}".`,
          customers,
          next_action:
            customers.length > 1
              ? "Several match: ask the merchant which one (by name and masked email) before using an id."
              : customers.length === 1
                ? "Confirm this is the right customer, then use its id."
                : "Offer to create the customer with create_customer (a name is enough; an email lets you prepare reminders).",
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "create_customer",
    {
      title: "Create customer",
      description:
        "Create a customer with only what's needed: a name, and an email if the merchant gives one. Refuses a likely duplicate (same name or email) and lists it instead; pass confirm_new only after the merchant confirms it's a different customer.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("The customer's or company's name, as the merchant said it."),
        email: z.string().max(254).optional().describe("Optional email, only if the merchant gave it."),
        confirm_new: z.boolean().optional().describe("true only after the merchant confirmed that a listed possible duplicate is a different customer."),
        idempotency_key: idempotencyKey,
        create_another: createAnother,
      },
      annotations: CREATE,
    },
    ({ name, email, confirm_new, idempotency_key, create_another }) =>
      ctx.reply(async () => {
        await ctx.require("customers", "Creating customers");
        const body = { name, ...(email ? { email } : {}), ...(confirm_new ? { confirm_new: true } : {}) };
        // the stored name is the one asked for (after the same trimming the server does), or it's not a success (F3)
        const verify = (c: Customer) => {
          if (untrusted(c.name, 100) !== untrusted(name, 100)) throw new Mismatch(`the customer came back as "${untrusted(c.name, 100)}", not "${untrusted(name, 100)}"`);
        };
        try {
          const written = await ctx.write("create_customer", body, { key: idempotency_key, createAnother: create_another }, (key) => ctx.client.createCustomer(body, key), verify);
          const { data, replayed } = written;
          return {
            summary: `${replayed ? "Found the customer created earlier" : "Created customer"} ${untrusted(data.name, 100)} (${data.id}).`,
            customer: customerOut(data),
            replayed,
            ...(replayed ? { note: replayNote(written, "customer") } : {}),
            next_action: "Use this customer_id for create_invoice_draft or create_payment_link.",
            data_notice: DATA_NOTICE,
          };
        } catch (error) {
          const duplicate = error instanceof ApiError && error.status === 409 ? DuplicateCustomersSchema.safeParse(error.body) : null;
          if (duplicate?.success) {
            const duplicates = duplicate.data.possible_duplicates.map(customerOut);
            return {
              summary: "Not created: a customer with this name or email may already exist.",
              created: false,
              possible_duplicates: duplicates,
              next_action: "Ask the merchant whether it's one of these (then use its id), or a different customer (then call create_customer again with confirm_new: true).",
              data_notice: DATA_NOTICE,
            };
          }
          throw error;
        }
      }),
  );
}
