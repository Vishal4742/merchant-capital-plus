// GET /api/v1/public/pages/{slug}: what the hosted /p/{slug} page renders (FR-GW-2). Public: no merchant-private fields.
import { HttpError, handle, ok } from "../../../../../../lib/server/http.ts";
import { pageBySlug, publicPageJson } from "../../../../../../lib/server/pages.ts";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return handle(async () => {
    const page = await pageBySlug((await params).slug);
    if (!page) throw new HttpError(404, "No such payment page.");
    return ok(publicPageJson(page));
  });
}
