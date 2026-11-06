// GET /api/v1/public/links/{slug}: what the hosted /l/{slug} page renders (FR-GW-1). Public: no merchant-private fields.
import { HttpError, handle, ok } from "../../../../../../lib/server/http.ts";
import { linkBySlug, publicLinkJson } from "../../../../../../lib/server/links.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const link = await linkBySlug((await params).slug);
    if (!link) throw new HttpError(404, "No such payment link.");
    return ok(publicLinkJson(link));
  });
}
