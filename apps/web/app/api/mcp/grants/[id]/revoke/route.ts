// POST /api/mcp/grants/{id}/revoke (batch 058; FR-MCP-1..3; SRS-CHANGE FR-MCP-20 proposed): Disconnect. The signed-in
// merchant revokes one of THEIR OWN grants; another merchant's id is a plain 404. Takes effect on the very next tool call
// and the next refresh (tokens are checked against the grant every time). Needs a CSRF token bound to the grant.
import { HttpError, handle, ok, readJson, signedInMerchant } from "../../../../../../lib/server/http.ts";
import { csrfOk, revokeGrant } from "../../../../../../lib/server/mcp-grants.ts";
import { internalSecret } from "../../../../../../lib/server/mcp-principal.ts";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await params;
    const secret = internalSecret();
    if (!secret) throw new HttpError(503, "The AI connection isn't switched on for this server.");
    const merchant = signedInMerchant(request);
    const body = await readJson(request);
    if (!csrfOk(body.csrf, merchant, id, secret)) throw new HttpError(403, "This page expired. Reload it and try again.");
    if (!(await revokeGrant(merchant, id))) throw new HttpError(404, "There's no active connection with that id.");
    return ok({ revoked: true });
  });
}
