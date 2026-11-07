// POST /api/v1/links: the merchant creates a payment link (FR-GW-1). GET: its links, newest first, with payments.
// Batch 052/054 (FR-GW-16, FR-MCP-15): a merchant's secret key (sk_test_…) works as well as the dashboard session, so the
// assistant connector can create links. A secret-key write must carry an Idempotency-Key (24 h, durable, per merchant
// and route), and the link and its replayable reply commit in one transaction (production review F1), so a retry after
// any failure or lost reply returns the same link and never makes a second one. A publishable key gets 403.
import { HttpError, handle, jsonObject, ok, rateLimit } from "../../../../lib/server/http.ts";
import { MAX_IDEMPOTENCY_KEY, idempotent, requestHash, send } from "../../../../lib/server/idempotency.ts";
import { callerMerchant } from "../../../../lib/server/keys.ts";
import { createLink, createLinkOnce, linkJson, listLinks } from "../../../../lib/server/links.ts";

const LINKS_PER_MINUTE = 30; // per merchant: a looping assistant can't flood the link table
const MAX_BODY = 16_384;

export async function POST(request: Request) {
  return handle(async () => {
    const { merchant, via } = await callerMerchant(request);
    rateLimit(`links:${merchant.toLowerCase()}`, LINKS_PER_MINUTE, 60_000);
    const text = await request.text();
    const body = jsonObject(text, MAX_BODY); // a malformed body is a 400 before any slot is taken
    const key = request.headers.get("idempotency-key");
    if (key === null) {
      // the dashboard may omit it (compatibility); an assistant's or server's key may not: its retries must be safe
      if (via === "secret_key") throw new HttpError(400, "Send an Idempotency-Key header with every secret-key write, so a retry can never create a second link.");
      return ok(linkJson(await createLink(merchant, body)), 201);
    }
    if (!key || key.length > MAX_IDEMPOTENCY_KEY) throw new HttpError(400, `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY} characters.`);
    // "links:" keeps a key the merchant also used for a checkout (POST /api/v1/sessions, slot "<merchant>:<key>") apart
    return send(await idempotent(`links:${merchant.toLowerCase()}:${key}`, requestHash(text), (own) => createLinkOnce(merchant, body, own)));
  });
}

export async function GET(request: Request) {
  return handle(async () => ok({ links: (await listLinks((await callerMerchant(request)).merchant)).map(linkJson) }));
}
