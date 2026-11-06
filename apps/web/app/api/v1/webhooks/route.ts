// POST /api/v1/webhooks {url} → {id, url, secret, created_at} (the secret once) · GET /api/v1/webhooks → endpoints with
// their last 20 deliveries (never the secret). The dashboard cookie, or the shop's secret API key from its own server or
// setup script (FR-GW-7, AT-14); publishable keys are refused.
import { handle, ok, readJson } from "../../../../lib/server/http.ts";
import { merchantByCookieOrSecretKey } from "../../../../lib/server/keys.ts";
import { createWebhook, listWebhooks } from "../../../../lib/server/webhooks.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const merchant = await merchantByCookieOrSecretKey(request);
    const body = await readJson(request);
    return ok(await createWebhook(merchant, body.url), 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const merchant = await merchantByCookieOrSecretKey(request);
    return ok({ webhooks: await listWebhooks(merchant) });
  });
}
