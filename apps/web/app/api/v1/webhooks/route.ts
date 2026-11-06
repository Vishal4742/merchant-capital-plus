// POST /api/v1/webhooks {url} → {id, url, secret, created_at} (the secret once) · GET /api/v1/webhooks → endpoints with
// their last 20 deliveries (never the secret). Dashboard only: the SIWE session cookie (FR-GW-7).
import { handle, ok, readJson, signedInMerchant } from "../../../../lib/server/http.ts";
import { createWebhook, listWebhooks } from "../../../../lib/server/webhooks.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    const body = await readJson(request);
    return ok(await createWebhook(merchant, body.url), 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    return ok({ webhooks: await listWebhooks(merchant) });
  });
}
