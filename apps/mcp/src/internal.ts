// The two signed messages this service sends to the web app (batch 058; FR-MCP-1..3; SRS-CHANGE FR-MCP-18/19 proposed):
//  - a CONSENT REQUEST, so the signed-in merchant can approve what an assistant asked for (aud whiteflow-consent), and
//  - a per-request gateway ASSERTION for a grant (aud whiteflow-gateway), used instead of the assistant's OAuth token.
// Same HMAC-SHA256 format as apps/web/lib/server/{mcp-grants,mcp-principal}.ts (the verifiers live there); the web tests
// and test/oauth-flow.test.ts pin the two copies together. The secret is MCP_INTERNAL_SECRET, shared by both projects.
import { createHmac, randomBytes } from "node:crypto";

const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");
const seal = (prefix: string, body: Record<string, unknown>, secret: string) => {
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${prefix}${payload}.${mac(payload, secret)}`;
};

export const GATEWAY_TTL_MS = 5 * 60_000;
export const CONSENT_TTL_MS = 10 * 60_000;

export function signAssertion(principal: { merchant: string; grantId: string }, secret: string, now: number): string {
  return seal("wfi1.", { m: principal.merchant.toLowerCase(), g: principal.grantId, aud: "whiteflow-gateway", exp: now + GATEWAY_TTL_MS, jti: randomBytes(9).toString("base64url") }, secret);
}

export interface ConsentRequest {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state?: string;
  resource: string;
}

export function signConsentRequest(request: ConsentRequest, secret: string, now: number): string {
  return seal("wfc1.", { ci: request.clientId, ru: request.redirectUri, cc: request.codeChallenge, sc: request.scopes, st: request.state, rs: request.resource, aud: "whiteflow-consent", exp: now + CONSENT_TTL_MS, jti: randomBytes(9).toString("base64url") }, secret);
}
