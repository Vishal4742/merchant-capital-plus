// get_operation_status (batch 052 round 2, production review F2): every write whose outcome isn't settled, from the
// connector's journal for this merchant, checked against the backend's own operation record where it offers one
// (GET /api/v1/operations/{key}; the sandbox does, the testnet gateway doesn't yet). "100% of unresolved writes visible."
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "../client.ts";
import { SERVER_RETENTION_MS, type Entry } from "../journal.ts";
import { ToolRefusal } from "../safety.ts";
import { IDEMPOTENCY_KEY, NEXT_RECONCILE, type Ctx } from "./context.ts";

const iso = (ms: number) => new Date(ms).toISOString();
const OPS: Record<string, string> = {
  create_customer: "create a customer",
  create_payment_link: "create a payment link",
  create_invoice_draft: "create an invoice draft",
  update_invoice_draft: "update an invoice draft",
  finalize_invoice: "request invoice publication",
};

export function registerOperationTools(server: McpServer, ctx: Ctx): void {
  server.registerTool(
    "get_operation_status",
    {
      title: "Operation status",
      description:
        "Writes whose outcome is still unknown or needs reconciliation (after a timeout, a lost reply, or a reply that didn't match the request), or one write by its idempotency_key: what was attempted, when, and what Whiteflow's records say. " +
        "Pass acknowledge: true only after the merchant has checked the record themselves; it clears the local flag so a new, identical request can be made.",
      inputSchema: {
        idempotency_key: z.string().regex(IDEMPOTENCY_KEY).optional().describe("One operation; leave out to list every unresolved one."),
        acknowledge: z.boolean().optional().describe("With idempotency_key: the merchant checked this record; stop treating it as unresolved."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ idempotency_key, acknowledge }) =>
      ctx.reply(async () => {
        const profile = await ctx.profile();
        const lookup = profile.account.capabilities.operations === true;
        const describe = async (entry: Entry) => {
          let server: Record<string, unknown> | null = null;
          if (lookup) {
            try {
              const { data } = await ctx.client.operation(entry.key);
              server = { state: data.state, http_status: data.http_status, record_id: data.result_id, at: data.created_at };
              if (data.state === "succeeded" && entry.outcome === "pending") ctx.journal.settle(profile.scope, entry.key, "done", data.result_id);
            } catch (error) {
              if (!(error instanceof ApiError) || error.status !== 404) throw error;
              server = { state: "not_found", note: "Whiteflow has no record of this key: if it's still within 24 hours, the write never happened" };
            }
          }
          return {
            idempotency_key: entry.key,
            attempted: OPS[entry.op] ?? entry.op,
            state: entry.outcome,
            first_attempt: iso(entry.at),
            resumable_until: entry.outcome === "pending" ? iso(entry.at + SERVER_RETENTION_MS) : null,
            note: entry.note,
            whiteflow_record: server ?? "this backend can't look operations up yet: check the record itself",
          };
        };
        if (idempotency_key) {
          const entry = ctx.journal.find(profile.scope, idempotency_key);
          if (!entry) throw new ToolRefusal("The connector has no record of that idempotency_key for this business.");
          if (acknowledge) {
            ctx.journal.settle(profile.scope, entry.key, "acknowledged", "the merchant checked the record");
            return { summary: `Marked ${entry.key} as checked by the merchant.`, operation: await describe({ ...entry, outcome: "acknowledged" }) };
          }
          return { summary: `Operation ${entry.key}: ${entry.outcome}.`, operation: await describe(entry) };
        }
        const unresolved = await Promise.all(ctx.journal.unresolved(profile.scope).map(describe));
        return {
          summary: unresolved.length ? `${unresolved.length} write(s) with an unsettled outcome.` : "No unresolved writes.",
          unresolved,
          ...(unresolved.length ? { next_action: `Retrying the same request resumes a "pending" one safely. For "needs_reconciliation": ${NEXT_RECONCILE}` } : {}),
        };
      }),
  );
}
