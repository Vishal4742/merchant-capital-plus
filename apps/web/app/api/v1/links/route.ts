// POST /api/v1/links: the merchant creates a payment link (FR-GW-1). GET: its links, newest first, with payments.
// Batch 051 R2-1: creating needs invoices:draft (Owner, Operator), listing invoices:read (any member).
// Batch 052/054 (FR-GW-16, FR-MCP-15): a linked workspace's secret key (sk_test_…) works as well as the session, so the
// assistant connector can create links. A secret-key write must carry an Idempotency-Key (24 h, durable, per merchant
// and route), and the link and its replayable reply commit in one transaction (production review F1), so a retry after
// any failure or lost reply returns the same link and never makes a second one. A publishable key gets 403.
import { HttpError, handle, jsonObject, ok, sharedRateLimit } from "../../../../lib/server/http.ts";
import { MAX_IDEMPOTENCY_KEY, idempotent, requestHash, send } from "../../../../lib/server/idempotency.ts";
import { auditV1, legacyAccess } from "../../../../lib/server/legacy.ts";
import { createLink, createLinkOnce, linkJson, listLinks } from "../../../../lib/server/links.ts";

const LINKS_PER_MINUTE = 30; // per merchant: a looping assistant can't flood the link table
const MAX_BODY = 16_384;
const KEYS = { secretKey: true, publishableForbidden: true } as const;

export async function POST(request: Request) {
  return handle(async () => {
    const access = await legacyAccess(request, "invoices:draft", KEYS);
    const { merchant } = access;
    await sharedRateLimit(`links:${merchant.toLowerCase()}`, LINKS_PER_MINUTE, 60_000, "closed"); // a write: no limit store, no link
    const text = await request.text();
    const body = jsonObject(text, MAX_BODY); // a malformed body is a 400 before any slot is taken
    const key = request.headers.get("idempotency-key");
    if (key === null) {
      // the dashboard may omit it (compatibility); an assistant's or server's key may not: its retries must be safe
      if (access.ctx.source !== "session") throw new HttpError(400, "Send an Idempotency-Key header with every secret-key or assistant write, so a retry can never create a second link.");
      const link = linkJson(await createLink(merchant, body));
      await auditV1(access, "links.create", link.id);
      return ok(link, 201);
    }
    if (!key || key.length > MAX_IDEMPOTENCY_KEY) throw new HttpError(400, `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY} characters.`);
    // "links:" keeps a key the merchant also used for a checkout (POST /api/v1/sessions, slot "<merchant>:<key>") apart.
    // The merchant is the workspace's one linked wallet (wf_businesses.legacy_merchant is UNIQUE), so this is per workspace too.
    const reply = await idempotent(`links:${merchant.toLowerCase()}:${key}`, requestHash(text), (own) => createLinkOnce(merchant, body, own));
    if (reply.status === 201 && !reply.replayed) await auditV1(access, "links.create", (reply.body as { id: string }).id); // a replay created nothing
    return send(reply);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "invoices:read", KEYS);
    return ok({ links: (await listLinks(merchant)).map(linkJson) });
  });
}
