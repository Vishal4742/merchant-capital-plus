// POST /api/v1/public/pages/{slug}/checkout: a payer opens a checkout from a page (FR-GW-2) → 303 to /checkout/{id}.
// {items: [{name, qty}]} for an items page, {amount} for an open-amount page; prices come from the stored page only.
import { handle } from "../../../../../../../lib/server/http.ts";
import { payPage } from "../../../../../../../lib/server/pages.ts";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => payPage(request, (await params).slug));
}
