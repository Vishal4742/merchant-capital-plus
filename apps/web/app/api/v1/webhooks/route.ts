// POST /api/v1/webhooks {url} → {id, url, secret, created_at} (the secret once) · GET /api/v1/webhooks → endpoints with
// their last 20 deliveries (never the secret). An Owner of the workspace that linked the merchant wallet, or that
// workspace's secret API key from the shop's own server or setup script (FR-GW-7, AT-14; batch 051 R2-1
// webhooks:manage). Publishable keys, and keys of a wallet no workspace linked, are refused.
import { handle, ok, readJson } from "../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../lib/server/legacy.ts";
import { createWebhook, listWebhooks } from "../../../../lib/server/webhooks.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const access = await legacyAccess(request, "webhooks:manage", { secretKey: true });
    const body = await readJson(request);
    const created = await createWebhook(access.merchant, body.url);
    await auditV1(access, "webhooks.create", created.id);
    return ok(created, 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "webhooks:manage", { secretKey: true });
    return ok({ webhooks: await listWebhooks(merchant) });
  });
}
