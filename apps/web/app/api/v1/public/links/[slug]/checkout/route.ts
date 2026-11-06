// POST /api/v1/public/links/{slug}/checkout: a payer opens a checkout from a link (FR-GW-1) → 303 to /checkout/{id}.
// Form or JSON body; only an open-amount link reads `amount`. 410 once the link is cancelled, paid (single-use) or expired.
import { handle } from "../../../../../../../lib/server/http.ts";
import { payLink } from "../../../../../../../lib/server/links.ts";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => payLink(request, (await params).slug));
}
