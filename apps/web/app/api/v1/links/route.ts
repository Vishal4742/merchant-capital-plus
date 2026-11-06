// POST /api/v1/links: the merchant creates a payment link (FR-GW-1). GET: its links, newest first, with payments.
// Batch 051 R2-1: creating needs invoices:draft (Owner, Operator), listing invoices:read (any member).
import { handle, ok, readJson } from "../../../../lib/server/http.ts";
import { auditV1, legacyAccess } from "../../../../lib/server/legacy.ts";
import { createLink, linkJson, listLinks } from "../../../../lib/server/links.ts";

export async function POST(request: Request) {
  return handle(async () => {
    const access = await legacyAccess(request, "invoices:draft");
    const link = linkJson(await createLink(access.merchant, await readJson(request)));
    await auditV1(access, "links.create", link.id);
    return ok(link, 201);
  });
}

export async function GET(request: Request) {
  return handle(async () => {
    const { merchant } = await legacyAccess(request, "invoices:read");
    return ok({ links: (await listLinks(merchant)).map(linkJson) });
  });
}
