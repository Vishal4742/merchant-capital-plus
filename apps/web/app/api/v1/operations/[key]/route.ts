// GET /api/v1/operations/{idempotency_key}: what happened to one of the caller's own writes, by its Idempotency-Key
// (batch 054, FR-MCP-15; production review F2: an assistant can resolve an unknown outcome instead of guessing). Links
// and checkouts share the slot table: "links:<merchant>:<key>" and "<merchant>:<key>". Session or secret key; another
// merchant's key, an unknown one or one older than the 24-hour retention is a 404.
import { HttpError, handle, ok } from "../../../../../lib/server/http.ts";
import { query } from "../../../../../lib/server/db.ts";
import { IDEMPOTENCY_MS, MAX_IDEMPOTENCY_KEY } from "../../../../../lib/server/idempotency.ts";
import { callerMerchant } from "../../../../../lib/server/keys.ts";

const NOT_FOUND = "No operation with that Idempotency-Key for this merchant (or it is older than 24 hours).";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  return handle(async () => {
    const { merchant } = await callerMerchant(request);
    const { key } = await params;
    if (!key || key.length > MAX_IDEMPOTENCY_KEY) throw new HttpError(404, NOT_FOUND);
    const m = merchant.toLowerCase();
    const rows = await query<{ slot: string; status: number | null; body: string | null; created_at: string }>(
      "SELECT slot, status, body::text AS body, created_at::text FROM app_web_idempotency WHERE slot = ANY($1) AND created_at >= $2 ORDER BY created_at DESC LIMIT 1",
      [[`links:${m}:${key}`, `${m}:${key}`], Date.now() - IDEMPOTENCY_MS],
    );
    const row = rows[0];
    if (!row) throw new HttpError(404, NOT_FOUND);
    let resultId: string | null = null;
    try {
      const body = row.body ? (JSON.parse(row.body) as { id?: unknown }) : null;
      resultId = typeof body?.id === "string" ? body.id : null;
    } catch {
      resultId = null;
    }
    return ok({
      idempotency_key: key,
      route: row.slot.startsWith("links:") ? "links" : "sessions",
      state: row.status === null ? "pending" : "succeeded", // only a created reply is ever stored (idempotency.ts)
      http_status: row.status,
      result_id: resultId,
      created_at: new Date(Number(row.created_at)).toISOString(),
    });
  });
}
