// POST /api/v1/pages: the merchant creates a payment page (FR-GW-2). GET: its pages, newest first, with payments.
// Batch 051 R2-1: creating needs invoices:draft (Owner, Operator), listing invoices:read (any member).
import { handle, ok, readJson } from "../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../lib/server/legacy.ts";
import { createPage, listPages, pageJson } from "../../../../lib/server/pages.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const access = await legacyAccess(request, "invoices:draft");
    const page = pageJson(await createPage(access.merchant, await readJson(request)));
    await auditV1(access, "pages.create", page.id);
    return ok(page, 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "invoices:read");
    return ok({ pages: (await listPages(merchant)).map(pageJson) });
  });
}
