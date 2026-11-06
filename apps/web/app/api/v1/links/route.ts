// POST /api/v1/links: the signed-in merchant creates a payment link (FR-GW-1). GET: its links, newest first, with payments.
import { handle, ok, readJson, signedInMerchant } from "../../../../lib/server/http.ts";
import { createLink, linkJson, listLinks } from "../../../../lib/server/links.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    return ok(linkJson(await createLink(merchant, await readJson(request))), 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => ok({ links: (await listLinks(signedInMerchant(request))).map(linkJson) }));
}
