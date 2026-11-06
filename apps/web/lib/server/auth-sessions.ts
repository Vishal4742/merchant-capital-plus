// Business sign-in and sessions (batch 050, SRS v3.1 FR-BIZ-6, FR-AUTH-1/2/5, NFR-17). Adapted from whiteflow-ef's
// batch-032 draft: the session, origin and context parts are kept; the SIWE login leg is replaced by Privy.
// - The browser signs in with Privy (email or an external wallet) and sends Privy's access token (Authorization:
//   Bearer) and identity token; lib/server/privy-token.ts verifies both (ES256, our app id). Only then is the Privy user
//   id trusted. The login identity is that id, never a wallet address.
// - Principal upsert, the Privy-verified wallet set, the session and the audit row are ONE statement.
// - The cookie carries a random 32-byte token; only its sha256 is stored. Expiry and revocation are checked on every
//   request. Tokens are never logged or audited.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookieFrom, setCookie } from "../auth.ts";
import { query } from "./db.ts";
import { HttpError, clientIp, sharedRateLimit } from "./http.ts";
import { AuthError, scopesFor, type AuthContext, type Principal, type Role } from "./identity.ts";
import { PrivyTokenError, privyConfig, verifyPrivyTokens } from "./privy-token.ts";

export const WF_SESSION_COOKIE = "wf_session";
export const WF_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SIGN_INS_PER_MINUTE = 20; // per IP
export const SIGN_IN_OFF = "Sign-in isn't set up on this server yet.";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("base64url")}`;
export const requestIdOf = (request: Request) => {
  const sent = request.headers.get("x-request-id");
  return sent && /^[A-Za-z0-9_.:-]{1,100}$/.test(sent) ? sent : randomUUID();
};

/** PUBLIC_ORIGIN (e.g. https://whiteflow.example): the only source of the proof domain/URI and the CSRF origin. */
export function publicOrigin(env: Record<string, string | undefined> = process.env): URL {
  const raw = env.PUBLIC_ORIGIN?.trim();
  if (!raw) throw new HttpError(503, SIGN_IN_OFF);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(503, SIGN_IN_OFF);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(503, SIGN_IN_OFF);
  return url;
}

/** CSRF and login-CSRF (032 R1-14): a cookie-authenticated unsafe request must come from our own origin. */
export function assertSameOrigin(request: Request, origin = publicOrigin()): void {
  const sent = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (sent !== null ? sent === origin.origin : site === "same-origin") return;
  throw new HttpError(403, "This request didn't come from the WhiteFlow site.");
}

const SQL_SIGN_IN = `WITH p AS (
    INSERT INTO wf_principals (id, privy_did, email, created_at, last_sign_in_at) VALUES ($1, $2, $3, $4, $4)
    ON CONFLICT (privy_did) DO UPDATE SET email = EXCLUDED.email, last_sign_in_at = EXCLUDED.last_sign_in_at
    RETURNING id
  ), gone AS (
    DELETE FROM wf_principal_wallets w USING p WHERE w.principal_id = p.id AND NOT (w.address = ANY ($5::text[]))
  ), added AS (
    INSERT INTO wf_principal_wallets (principal_id, address, updated_at) SELECT p.id, a, $4 FROM p, unnest($5::text[]) AS a
    ON CONFLICT (principal_id, address) DO UPDATE SET updated_at = EXCLUDED.updated_at
  ), s AS (
    INSERT INTO wf_sessions (id, token_hash, principal_id, active_business_id, privy_sid, created_at, last_auth_at, expires_at)
    SELECT $6, $7, p.id,
      (SELECT m.business_id FROM wf_memberships m WHERE m.principal_id = p.id ORDER BY m.created_at, m.business_id LIMIT 1),
      $8, $4, $4, $9
    FROM p
    RETURNING id, principal_id
  ), a AS (
    INSERT INTO wf_audit_events (id, actor_principal_id, source, credential_id, request_id, action, outcome, at)
    SELECT $10, principal_id, 'session', id, $11, 'auth.sign_in', 'ok', $4 FROM s
  )
  SELECT id, principal_id FROM s`;

/** Verifies the Privy tokens and starts a WhiteFlow session. Returns the Set-Cookie value and the principal. */
export async function signInWithPrivy(request: Request, body: { idToken?: unknown }, now = Date.now()): Promise<{ cookie: string; principal: Principal }> {
  const origin = publicOrigin();
  assertSameOrigin(request, origin);
  const config = privyConfig();
  if (!config) throw new HttpError(503, SIGN_IN_OFF);
  await sharedRateLimit(`signin:${clientIp(request)}`, SIGN_INS_PER_MINUTE, 60_000, "closed");
  const auth = request.headers.get("authorization") ?? "";
  const accessToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const idToken = typeof body.idToken === "string" ? body.idToken : "";
  let user;
  try {
    user = verifyPrivyTokens(accessToken, idToken, config, now);
  } catch (err) {
    if (err instanceof PrivyTokenError) {
      console.error("sign-in refused:", err.message); // a reason only: never a token or a claim value
      throw new AuthError("We couldn't confirm your sign-in. Sign in again.");
    }
    throw err;
  }
  const token = randomBytes(32).toString("base64url");
  const rows = await query<{ id: string; principal_id: string }>(SQL_SIGN_IN, [
    newId("pr"), user.did, user.email, now, user.wallets, newId("ses"), sha256(token), user.sid, now + WF_SESSION_TTL_MS, newId("aud"), requestIdOf(request),
  ]);
  if (rows.length !== 1) throw new HttpError(503, "We couldn't start your session. Try again.");
  return {
    cookie: setCookie(WF_SESSION_COOKIE, token, WF_SESSION_TTL_MS / 1000, origin.protocol === "https:"),
    principal: { id: rows[0].principal_id, privyDid: user.did, email: user.email, wallets: user.wallets },
  };
}

/** Revokes the caller's session server-side (a copied cookie stops working) and returns the clearing Set-Cookie. */
export async function signOut(request: Request, now = Date.now()): Promise<string> {
  const origin = publicOrigin();
  assertSameOrigin(request, origin);
  const token = cookieFrom(request, WF_SESSION_COOKIE);
  if (token) {
    await query(
      `WITH s AS (UPDATE wf_sessions SET revoked_at = $2 WHERE token_hash = $1 AND revoked_at IS NULL RETURNING id, principal_id)
       INSERT INTO wf_audit_events (id, actor_principal_id, source, credential_id, request_id, action, outcome, at)
       SELECT $3, principal_id, 'session', id, $4, 'auth.sign_out', 'ok', $2 FROM s`,
      [sha256(token), now, newId("aud"), requestIdOf(request)],
    );
  }
  return setCookie(WF_SESSION_COOKIE, "", 0, origin.protocol === "https:");
}

/** AuthContext from the session cookie (FR-AUTH-1): the membership role in the session's active workspace, re-read on
 *  every request (no cache), so a removal or demotion takes effect on the next request. 401 without a live session.
 *  API keys join in batch 051 (their workspace link is backfilled there). */
export async function contextFromRequest(request: Request, now = Date.now()): Promise<AuthContext> {
  const token = cookieFrom(request, WF_SESSION_COOKIE);
  if (!token) throw new AuthError();
  const [row] = await query<{ id: string; principal_id: string; active_business_id: string | null; role: Role | null }>(
    `SELECT s.id, s.principal_id, s.active_business_id, m.role
     FROM wf_sessions s LEFT JOIN wf_memberships m ON m.business_id = s.active_business_id AND m.principal_id = s.principal_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`,
    [sha256(token), now],
  );
  if (!row) throw new AuthError("Your session ended. Sign in again.");
  const role = row.role ?? null;
  return {
    principalId: row.principal_id,
    businessId: role ? row.active_business_id : null, // a removed membership means no workspace context
    role,
    scopes: role ? scopesFor(role) : new Set(),
    source: "session",
    credentialId: row.id,
    requestId: requestIdOf(request),
  };
}

/** Like contextFromRequest, for unsafe methods: also requires our own origin (CSRF). */
export async function mutationContext(request: Request, now = Date.now()): Promise<AuthContext> {
  assertSameOrigin(request);
  return contextFromRequest(request, now);
}
