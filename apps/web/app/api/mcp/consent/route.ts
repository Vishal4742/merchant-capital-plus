import { legacyAccess } from "../../../../lib/server/legacy.ts";
// POST /api/mcp/consent (batch 058; FR-MCP-1..3; SRS-CHANGE FR-MCP-19 proposed): the merchant's answer to an assistant's
// request for access. JSON only, so a cross-site form can't send it. Needs the signed-in session AND a CSRF token bound to
// that merchant and that request; the merchant on the grant is the session's, never anything in the body. Answers
// { redirect }: the client's own callback with a code (approve) or access_denied (deny). The page navigates there itself,
// because this site's form-action 'self' policy would block a form redirected off site.
import { GrantRefusal, approveGrant, csrfOk, denyRedirect, issuerOf, verifyConsentRequest } from "../../../../lib/server/mcp-grants.ts";
import { HttpError, handle, ok, readJson } from "../../../../lib/server/http.ts";
import { internalSecret } from "../../../../lib/server/mcp-principal.ts";

export async function POST(request: Request) {
  return handle(async () => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw new HttpError(415, "Send JSON.");
    const secret = internalSecret();
    const issuer = issuerOf();
    if (!secret || !issuer) throw new HttpError(503, "The AI connection isn't switched on for this server.");
    const { merchant, ctx } = await legacyAccess(request, "business:manage");
    if (ctx.source !== "session" || !ctx.principalId) throw new HttpError(403, "An Owner must manage assistant connections.");
    const body = await readJson(request);
    const token = typeof body.request === "string" ? body.request : "";
    if (!csrfOk(body.csrf, merchant, token, secret)) throw new HttpError(403, "This page expired. Reload it and try again.");
    const consent = verifyConsentRequest(token, secret);
    if (!consent) throw new HttpError(400, "This request expired or isn't valid. Start the connection again from your assistant.");
    if (body.decision === "deny") return ok({ redirect: denyRedirect(consent, issuer) });
    if (body.decision !== "approve") throw new HttpError(400, "Choose Approve or Deny.");
    const approved = Array.isArray(body.scopes) ? body.scopes.filter((s): s is string => typeof s === "string") : [];
    try {
      const { redirect } = await approveGrant({ owner: merchant, merchant, businessId: ctx.businessId, principalId: ctx.principalId, request: consent, approved, issuer });
      return ok({ redirect });
    } catch (error) {
      if (error instanceof GrantRefusal) throw new HttpError(400, error.message);
      throw error;
    }
  });
}
