// The merchant's tools (FR-MCP-2): create and read checkouts, list payments, a sales summary. Each calls the public
// gateway API with the merchant's own sk_test_ key through packages/sdk's Gateway (key scrubbed from its errors,
// timeouts, retries, redirects refused). None of them moves money, signs, refunds or touches keys, wallets or
// webhooks (FR-MCP-3).
import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Gateway } from "../../../sdk/index.ts";
import { CURRENCIES, checkoutId, explorer, parseUsdt, usdt, type Reply } from "../common.ts";

const MAX_DESCRIPTION = 40; // it becomes the checkout's reference, which POST /api/v1/sessions caps at 40
const PAGE_SIZE = 100; // GET /api/v1/payments' maximum limit
const MAX_PAGES = 20; // ponytail: a summary reads at most 2,000 payments and says complete: false past that
const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MerchantContext {
  gateway: Gateway;
  base: URL;
  reply: Reply;
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

/** "2026-11-06" → its 00:00 UTC in ms; refuses a malformed or impossible date (2026-02-30). */
function utcDate(text: string, name: string): number {
  const ms = DATE.test(text) ? Date.parse(`${text}T00:00:00Z`) : NaN;
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== text) throw new Error(`${name} must be a date like 2026-11-06.`);
  return ms;
}

/** An API amount ("1234.50"; commas tolerated) → USDT units. */
const apiUnits = (text: string) => parseUsdt(String(text).replaceAll(",", ""), "a payment amount from the gateway");

export function registerMerchantTools(server: McpServer, { gateway, base, reply }: MerchantContext): void {
  server.registerTool(
    "create_checkout",
    {
      title: "Create a checkout",
      description:
        "Create a hosted checkout and get the URL to send the customer. Creates no payment: nothing moves until the customer pays at the URL. " +
        "A price in a currency other than USDT is converted at a rate locked for the checkout (USD is 1:1).",
      inputSchema: {
        amount: z.string().describe('The price, like "25.00" (at most 6 decimals), in `currency`.'),
        currency: z.enum(CURRENCIES).default("USDT").describe("The price's currency."),
        description: z.string().max(MAX_DESCRIPTION).optional().describe("What it's for (at most 40 characters). Shown as the checkout's reference."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    ({ amount, currency, description }) =>
      reply(async () => {
        if (parseUsdt(amount) === 0n) throw new Error("amount must be more than 0.");
        const reference = description?.trim() || undefined;
        // the idempotency key makes the SDK's retry of a lost reply return the same checkout, never a second one
        const session = await gateway.sessions.create({ amount, currency, orderId: reference }, { idempotencyKey: randomUUID() });
        return {
          id: session.id,
          url: session.url,
          amountUsdt: session.amount,
          currency: session.currency ?? currency,
          ...(session.priced ? { priced: session.priced } : {}),
          expiresAt: session.expiresAt,
          note: "Send the customer this URL. No payment is made until they pay there; check it with get_checkout.",
        };
      }),
  );

  server.registerTool(
    "get_checkout",
    {
      title: "Get a checkout",
      description: "Read a checkout's status (open, pending, paid, expired) and amount. Once paid: its tx hash and explorer link, and any refund.",
      inputSchema: { checkout: z.string().describe("The checkout id, or its URL from create_checkout.") },
      annotations: READ_ONLY,
    },
    ({ checkout }) =>
      reply(async () => {
        const session = await gateway.sessions.retrieve(checkoutId(checkout, base));
        return { ...session, explorer: explorer(session.txHash) };
      }),
  );

  server.registerTool(
    "list_payments",
    {
      title: "List payments",
      description: "List recent payments, newest first: amount and refunded in USDT, reference, time, and each tx with its explorer link.",
      inputSchema: { limit: z.number().int().min(1).max(PAGE_SIZE).default(20).describe("How many, 1 to 100.") },
      annotations: READ_ONLY,
    },
    ({ limit }) =>
      reply(async () => {
        const { data, next } = await gateway.payments.list({ limit });
        return { payments: data.map((payment) => ({ ...payment, explorer: explorer(payment.txHash) })), more: next !== null };
      }),
  );

  server.registerTool(
    "sales_summary",
    {
      title: "Sales summary",
      description: "Total sales for a date range (UTC days, both inclusive): gross, refunded, net and the number of payments, in USDT. Computed from list_payments.",
      inputSchema: {
        from: z.string().describe("First day, like 2026-11-01 (UTC)."),
        to: z.string().describe("Last day, like 2026-11-06 (UTC)."),
      },
      annotations: READ_ONLY,
    },
    ({ from, to }) =>
      reply(async () => {
        const start = utcDate(from, "from"), end = utcDate(to, "to") + DAY_MS;
        if (end <= start) throw new Error("from must be on or before to.");
        let cursor: string | undefined, count = 0, gross = 0n, refunded = 0n, complete = false;
        // newest first: skip payments after `to`, stop at the first one before `from`
        for (let page = 0; page < MAX_PAGES && !complete; page++) {
          const { data, next } = await gateway.payments.list({ limit: PAGE_SIZE, cursor });
          for (const payment of data) {
            const at = Date.parse(payment.paidAt);
            if (at >= end) continue;
            if (at < start) {
              complete = true;
              break;
            }
            count++;
            gross += apiUnits(payment.amount);
            refunded += apiUnits(payment.refunded);
          }
          if (next === null) complete = true;
          cursor = next ?? undefined;
        }
        const partial = complete ? {} : { note: `Only the newest ${MAX_PAGES * PAGE_SIZE} payments were read; older ones in the range are missing.` };
        return { from, to, count, gross: usdt(gross), refunded: usdt(refunded), net: usdt(gross - refunded), currency: "USDT", complete, ...partial };
      }),
  );
}
