// create_payment_link, get_payment_link (batch 052; FR-GW-1, FR-GW-11, FR-MCP-11, FR-MCP-15). Creating a link sends it
// to nobody: the result says so and gives the URL to share. Paid status is the backend's own record (testnet: the
// payment the relayer submitted and the chain confirmed), never the model's reading of a page or redirect.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Link } from "../contract.ts";
import { DateError, calendarDate, dateIn, endOfDay, labelled } from "../dates.ts";
import { CURRENCIES, MoneyError, decimal, display, fromApi, parseMoney, type Currency } from "../money.ts";
import { DATA_NOTICE, ToolRefusal, untrusted } from "../safety.ts";
import { createAnother, idempotencyKey } from "./business.ts";
import { EXPLORER_TX, Mismatch, replayNote, type Ctx, type Profile } from "./context.ts";

const LINK_ID = /^lnk_[A-Za-z0-9_-]{1,40}$/;

/** The link's price as WhiteFlow stored it. The dashboard accepts up to 6 decimals in any currency, so a stored price can
 *  be finer than the currency's minor unit (e.g. 10.555 INR): then it's shown exactly as stored, never rounded. */
function price(text: string | null, currency: Currency): { amount: string | null; display: string } {
  if (text === null) return { amount: null, display: "the customer enters the amount" };
  try {
    const units = fromApi(text, currency);
    return { amount: decimal(units, currency), display: display(units, currency) };
  } catch {
    return { amount: text, display: `${text} ${currency}` };
  }
}

/** A link's URL, only if it's on a trusted WhiteFlow origin; for a read, an untrusted one is refused outright. */
function readUrl(ctx: Ctx, value: string): string {
  try {
    return ctx.trustedUrl(value, "the link's URL");
  } catch (error) {
    if (error instanceof Mismatch) throw new ToolRefusal(`WhiteFlow returned a link URL that isn't on a trusted origin (${error.message}). Don't share it; check the link in the dashboard.`);
    throw error;
  }
}

function linkOut(link: Link, url: string, profile: Profile) {
  const currency = link.currency as Currency;
  const { amount, display: shown } = price(link.amount, currency);
  return {
    id: link.id,
    url,
    amount,
    currency,
    amount_display: shown,
    description: untrusted(link.description),
    reference: link.reference_id ? untrusted(link.reference_id, 40) : null,
    status: link.status,
    single_use: link.single_use,
    expires: link.expires_at ? { at: link.expires_at, last_day: labelled(dateIn(Date.parse(link.expires_at) - 1, profile.zone), profile.zone) } : null,
    paid_checkouts: link.payments,
  };
}

const conversionNote = (currency: Currency) =>
  currency === "USDT"
    ? "The customer pays this exact amount in USDT on the settlement network."
    : `Priced in ${currency}. When the customer opens the link, WhiteFlow converts it to USDT at a rate locked for that checkout (shown to the customer); they pay USDT and you receive USDT. The connector did not convert anything.`;

export function registerLinkTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "create_payment_link",
    {
      title: "Create payment link",
      description:
        "Create a hosted payment link and return its URL and status. It is NOT sent to anyone: the merchant shares the URL. Single-use by default (one payment closes it). " +
        "currency is the price's currency, exactly as the merchant said it (₹ → INR, $ → USD); never convert it yourself. A price not in USDT is converted by WhiteFlow at checkout.",
      inputSchema: {
        amount: z.string().max(30).describe('The price as a decimal string in `currency`, e.g. "15000" or "15000.00" (at most 2 decimals for fiat, 6 for USDT).'),
        currency: z.enum(CURRENCIES).describe("The price's currency, as the merchant stated it. Ask if unclear; don't assume."),
        description: z.string().min(1).max(200).describe("What it's for, shown to the customer, e.g. \"Acme website redesign\"."),
        customer_id: z.string().max(64).optional().describe("Optional customer id from search_customers/create_customer (sandbox backend only)."),
        reference: z.string().max(40).optional().describe("Optional merchant reference (unique per link), e.g. an order number."),
        expires_on: z.string().optional().describe("Optional last day the link can be paid, YYYY-MM-DD in the business time zone (it closes at the end of that day)."),
        single_use: z.boolean().default(true).describe("true (default): closes after one payment. false: a reusable link."),
        idempotency_key: idempotencyKey,
        create_another: createAnother,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (input) =>
      ctx.reply(async () => {
        const profile = await ctx.require("links", "Payment links");
        let price;
        try {
          price = parseMoney(input.amount, input.currency, "amount");
        } catch (error) {
          if (error instanceof MoneyError) throw new ToolRefusal(error.message, { next_action: "Ask the merchant for the exact amount." });
          throw error;
        }
        if (input.customer_id && !profile.account.capabilities.customers) {
          throw new ToolRefusal("This backend can't attach a customer to a link yet. Create the link without customer_id (name the customer in the description if it should show at checkout).");
        }
        let expiresAt: string | undefined;
        if (input.expires_on) {
          try {
            const day = calendarDate(input.expires_on, "expires_on");
            if (day < profile.today) throw new DateError(`expires_on ${day} is in the past (today is ${labelled(profile.today, profile.zone)}).`);
            expiresAt = new Date(endOfDay(day, profile.zone)).toISOString();
          } catch (error) {
            if (error instanceof DateError) throw new ToolRefusal(error.message);
            throw error;
          }
        }
        const body = {
          amount: decimal(price.units, price.currency),
          currency: price.currency,
          description: input.description,
          single_use: input.single_use,
          ...(input.reference ? { reference_id: input.reference } : {}),
          ...(expiresAt ? { expires_at: expiresAt } : {}),
          ...(input.customer_id ? { customer_id: input.customer_id } : {}),
        };
        let url = "";
        // the link must be the one asked for: same price, currency, text, reference, use and expiry, on a trusted
        // origin. Anything else is never reported as a success (production review F3).
        const verify = (got: Link) => {
          const wrong: string[] = [];
          let units: bigint | null = null;
          try {
            units = got.amount === null ? null : fromApi(got.amount, price.currency);
          } catch {
            wrong.push(`amount ${got.amount}`);
          }
          if (units !== price.units) wrong.push(`amount ${got.amount ?? "none"} instead of ${body.amount}`);
          if (got.currency !== price.currency) wrong.push(`currency ${got.currency} instead of ${price.currency}`);
          // compared after the same normalisation (trim, collapsed spaces, no control characters) on both sides
          const same = (a: string | null | undefined, b: string | null | undefined) => untrusted(a ?? "", 400) === untrusted(b ?? "", 400);
          if (!same(got.description, input.description)) wrong.push("a different description");
          if (!same(got.reference_id, input.reference)) wrong.push("a different reference");
          if (got.single_use !== input.single_use) wrong.push(`single_use ${got.single_use}`);
          if ((got.expires_at ? Date.parse(got.expires_at) : null) !== (expiresAt ? Date.parse(expiresAt) : null)) wrong.push("a different expiry");
          if (got.customer_id !== undefined && (got.customer_id ?? null) !== (input.customer_id ?? null)) wrong.push("a different customer");
          if (wrong.length) throw new Mismatch(wrong.join(", "));
          url = ctx.trustedUrl(got.url, "the link's URL");
        };
        const written = await ctx.write("create_payment_link", body, { key: input.idempotency_key, createAnother: input.create_another }, (key) => ctx.client.createLink(body, key), verify);
        const { data, replayed } = written;
        const link = linkOut(data, url, profile);
        return {
          summary: `${replayed ? "Found the payment link already created" : "Created a payment link"} for ${link.amount_display} — ${link.description}. Status: ${link.status}.`,
          link,
          delivered: false,
          delivery_note: "WhiteFlow did not send this link to anyone. Share the URL with the customer yourself.",
          settlement_note: conversionNote(price.currency),
          replayed,
          ...(replayed ? { note: replayNote(written, "link") } : {}),
          next_action: `Send ${link.url} to the customer. Later, ask "has it been paid?" (get_payment_link ${data.id}).`,
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "get_payment_link",
    {
      title: "Get payment link",
      description: "A payment link's current status (active, paid, expired, cancelled) and the verified payments made through it, newest first, from WhiteFlow's own records.",
      inputSchema: { link_id: z.string().max(64).describe("The link id, like lnk_…, from create_payment_link.") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ link_id }) =>
      ctx.reply(async () => {
        const profile = await ctx.require("links", "Payment links");
        if (!LINK_ID.test(link_id)) throw new ToolRefusal("link_id must be a link id like lnk_…; find it in the create_payment_link result.");
        const { data: detail } = await ctx.client.getLink(link_id);
        if (detail.id !== link_id) throw new ToolRefusal("WhiteFlow returned a different link than the one asked for; check it in the dashboard.");
        const payments = detail.paid_checkouts.map((p) => ({
          id: p.payment_id ?? p.session_id,
          amount: decimal(fromApi(p.amount, "USDT"), "USDT"),
          currency: "USDT",
          status: "confirmed",
          paid_at: p.paid_at,
          evidence: p.tx_hash ? `${EXPLORER_TX}${p.tx_hash}` : ctx.mode === "sandbox" ? `sandbox payment ${p.session_id}` : null,
        }));
        const link = linkOut(detail, readUrl(ctx, detail.url), profile);
        return {
          summary: `Link ${detail.id} (${link.amount_display}, ${link.description}) is ${detail.status}${payments.length ? ` with ${payments.length} verified payment(s)` : ", with no payment yet"}.`,
          link,
          payments,
          paid: payments.length > 0,
          next_action: payments.length ? "Tell the merchant it's paid, with the amount received in USDT." : detail.status === "active" ? "Not paid yet. The merchant can share the URL again." : `The link is ${detail.status}; create a new one if the customer still needs to pay.`,
          data_notice: DATA_NOTICE,
        };
      }),
  );
}
