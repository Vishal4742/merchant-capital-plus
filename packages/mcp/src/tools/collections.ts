// list_payments, get_collection_summary (batch 052; FR-GW-5, FR-GW-9). Only verified payments: on testnet the
// gateway's list is MerchantPay's Paid records, read on chain; in the sandbox, payments the signed provider events
// confirmed. Currencies stay separate; nothing is converted. Values the backend doesn't provide are null, never guessed.
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ApiPayment } from "../contract.ts";
import { DateError, PERIODS, labelled, resolveRange, type Period } from "../dates.ts";
import { display, fromApi, type Currency } from "../money.ts";
import { DATA_NOTICE, ToolRefusal, untrusted } from "../safety.ts";
import { EXPLORER_TX, type Ctx } from "./context.ts";

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

function paymentOut(ctx: Ctx, p: ApiPayment) {
  return {
    id: p.paymentId,
    amount: p.amount,
    currency: "USDT",
    amount_display: display(fromApi(p.amount, "USDT"), "USDT"),
    refunded: p.refunded,
    status: fromApi(p.refunded, "USDT") > 0n ? "confirmed (partly or fully refunded)" : "confirmed",
    paid_at: p.paidAt,
    related: {
      invoice: p.invoiceNumber ?? (p.invoiceId ? `${ctx.mode === "testnet" ? "on-chain invoice #" : ""}${p.invoiceId}` : null),
      link_id: p.linkId ?? null,
      checkout_session: p.sessionId,
      reference: p.reference ? untrusted(p.reference, 80) : null,
    },
    evidence: p.txHash ? `${EXPLORER_TX}${p.txHash}` : ctx.mode === "sandbox" ? "sandbox: confirmed by a signed provider event" : null,
  };
}

export function registerCollectionTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "list_payments",
    {
      title: "List payments",
      description: "Verified payments received, newest first: amount in USDT, refunded amount, time, the related invoice or link, and evidence (an explorer link on testnet). A cursor pages through older ones.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).default(20).describe("How many, 1 to 100."),
        cursor: z.string().max(80).optional().describe("The `next_cursor` of the previous page."),
      },
      annotations: READ,
    },
    ({ limit, cursor }) =>
      ctx.reply(async () => {
        await ctx.require("payments", "Payments");
        const { data } = await ctx.client.listPayments({ limit, cursor });
        const payments = data.data.map((p) => paymentOut(ctx, p));
        return {
          summary: payments.length ? `${payments.length} verified payment(s)${data.next ? "; more on the next page" : ""}.` : "No payments yet.",
          payments,
          next_cursor: data.next,
          data_notice: DATA_NOTICE,
        };
      }),
  );

  server.registerTool(
    "get_collection_summary",
    {
      title: "Collection summary",
      description:
        "Money collected in a period (gross, fees, refunds, net and count, per currency) and, where the backend has invoices, what is outstanding and overdue now. Days are the business's own time zone. Give a period, or from and to.",
      inputSchema: {
        period: z.enum(PERIODS as [Period, ...Period[]]).optional().describe("this_week starts on Monday. Default: this_week."),
        from: z.string().optional().describe("YYYY-MM-DD, inclusive (with to; instead of period)."),
        to: z.string().optional().describe("YYYY-MM-DD, inclusive."),
      },
      annotations: READ,
    },
    (input) =>
      ctx.reply(async () => {
        const profile = await ctx.require("reports", "Collection summaries");
        let range;
        try {
          range = resolveRange(input.period || input.from || input.to ? input : { period: "this_week" }, profile.today);
        } catch (error) {
          if (error instanceof DateError) throw new ToolRefusal(error.message);
          throw error;
        }
        const { data: report } = await ctx.client.report({ ...range, tz: profile.zone });
        const t = report.totals;
        const usdt = (text: string) => display(fromApi(text, "USDT"), "USDT");
        let receivables: Record<string, unknown> | null = null;
        if (profile.account.capabilities.invoices) {
          const { data } = await ctx.client.receivables();
          receivables = Object.fromEntries(
            Object.entries(data.by_currency).map(([c, r]) => [c, { outstanding: display(fromApi(r.outstanding, c as Currency), c as Currency), overdue: display(fromApi(r.overdue, c as Currency), c as Currency), open_invoices: r.open_count, overdue_invoices: r.overdue_count }]),
          );
        }
        return {
          summary: `${labelled(range.from, profile.zone)} to ${labelled(range.to, profile.zone)}: collected ${usdt(t.gross)} gross from ${t.count} payment(s), ${usdt(t.net)} net.`,
          range: { from: range.from, to: range.to, timezone: profile.zone },
          collected: {
            USDT: { gross: usdt(t.gross), fees: usdt(t.fees), refunds: usdt(t.refunds), net: usdt(t.net), payments: t.count },
          },
          collected_notes: [
            "Every payment settles in USDT, whatever currency its link was priced in; no other currency is collected.",
            ctx.mode === "testnet"
              ? "From Whiteflow's on-chain payment records. fees = the relay fee MerchantPay took; net = what reached you (and any financing investors) before refunds."
              : "SANDBOX: simulated payments; the simulator charges no fees and has no refunds.",
          ],
          receivables_now: receivables,
          ...(receivables ? { receivables_as_of: labelled(profile.today, profile.zone) } : { receivables_note: "Outstanding and overdue amounts need invoices, which this backend doesn't have yet." }),
          settlement: null,
          settlement_note: "This backend doesn't report settlement separately from collection.",
          by_day: report.days.filter((d) => d.count > 0).map((d) => ({ date: d.date, gross: usdt(d.gross), net: usdt(d.net), payments: d.count })),
        };
      }),
  );
}
