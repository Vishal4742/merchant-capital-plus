// POST /api/v1/pages: the signed-in merchant creates a payment page (FR-GW-2). GET: its pages, newest first, with payments.
import { handle, ok, readJson, signedInMerchant } from "../../../../lib/server/http.ts";
import { createPage, listPages, pageJson } from "../../../../lib/server/pages.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    return ok(pageJson(await createPage(merchant, await readJson(request))), 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => ok({ pages: (await listPages(signedInMerchant(request))).map(pageJson) }));
}
