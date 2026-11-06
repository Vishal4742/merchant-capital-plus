// POST /api/v1/links: the merchant creates a payment link (FR-GW-1). GET: its links, newest first, with payments.
// Batch 052 (FR-GW-16 proposed): a merchant's secret key (sk_test_…) works as well as the dashboard session, so the
// assistant connector can create links; POST takes an Idempotency-Key (24 h, durable, per merchant and route), so a
// retry after a lost reply returns the same link and never a second one. A publishable key gets 403.
import { HttpError, handle, jsonObject, ok, rateLimit } from "../../../../lib/server/http.ts";
import { MAX_IDEMPOTENCY_KEY, idempotent, requestHash, send, type Reply } from "../../../../lib/server/idempotency.ts";
import { callerMerchant } from "../../../../lib/server/keys.ts";
import { createLink, linkJson, listLinks } from "../../../../lib/server/links.ts";

const LINKS_PER_MINUTE = 30; // per merchant: a looping assistant can't flood the link table
const MAX_BODY = 16_384;

export async function POST(request: Request) {
  return handle(async () => {
    const { merchant } = await callerMerchant(request);
    rateLimit(`links:${merchant.toLowerCase()}`, LINKS_PER_MINUTE, 60_000);
    const text = await request.text();
    if (text.length > MAX_BODY) throw new HttpError(413, "That request is too large.");
    const create = async (): Promise<Reply> => {
      try {
        return { status: 201, body: linkJson(await createLink(merchant, jsonObject(text, MAX_BODY))) };
      } catch (err) {
        if (err instanceof HttpError) return { status: err.status, body: { error: err.message } }; // frees the key
        throw err;
      }
    };
    const key = request.headers.get("idempotency-key");
    if (key === null) return send(await create());
    if (!key || key.length > MAX_IDEMPOTENCY_KEY) throw new HttpError(400, `Idempotency-Key must be 1 to ${MAX_IDEMPOTENCY_KEY} characters.`);
    // "links:" keeps a key the merchant also used for a checkout (POST /api/v1/sessions, slot "<merchant>:<key>") apart
    return send(await idempotent(`links:${merchant.toLowerCase()}:${key}`, requestHash(text), create));
  });
}

export async function GET(request: Request) {
  return handle(async () => ok({ links: (await listLinks((await callerMerchant(request)).merchant)).map(linkJson) }));
}
