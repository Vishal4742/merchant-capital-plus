// Business sign-in (batch 050, SRS FR-BIZ-6 v3.1): Privy signs an ES256 access token and an identity token for the
// signed-in user; we verify both ourselves with Privy's public verification key (node:crypto, no new dependency) and
// only then trust the user id, the verified email and the external wallets. Privy's documented checks: algorithm
// ES256, issuer "privy.io", audience = our Privy app id, expiry (docs.privy.io, access tokens / identity tokens).
// Messages never contain a token or a claim value: they go to logs and to the 401 body.
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { isAddress } from "viem";

const MAX_TOKEN_BYTES = 4096;
const SKEW_S = 30; // clock difference tolerated between Privy and us
const DID = /^did:privy:[A-Za-z0-9]{1,64}$/;
const APP_ID = /^[a-z0-9]{20,40}$/i; // as lib/privy-config.ts

export class PrivyTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrivyTokenError";
  }
}

export interface PrivyConfig {
  appId: string;
  verificationKey: string; // SPKI PEM, public (Privy dashboard → App settings → verification key)
}

export interface PrivyUser {
  did: string;
  sid: string | null; // Privy's session id, recorded with our session
  email: string | null; // lowercase; only from a verified identity token
  wallets: `0x${string}`[]; // lowercase external EVM wallets Privy verified (embedded "privy" wallets excluded)
}

const keys = new Map<string, KeyObject>();
function keyOf(pem: string): KeyObject {
  let key = keys.get(pem);
  if (!key) {
    key = createPublicKey(pem);
    if (key.asymmetricKeyType !== "ec") throw new PrivyTokenError("the verification key is not an EC public key");
    keys.set(pem, key);
  }
  return key;
}

/** Our Privy app id and verification key from the environment, or null (then sign-in answers 503). */
export function privyConfig(env: Record<string, string | undefined> = process.env): PrivyConfig | null {
  const appId = env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const pem = env.PRIVY_VERIFICATION_KEY?.trim().replaceAll("\\n", "\n");
  if (!appId || !APP_ID.test(appId) || !pem) return null;
  try {
    keyOf(pem);
  } catch {
    return null;
  }
  return { appId, verificationKey: pem };
}

type Claims = Record<string, unknown>;

function decodeJson(part: string, what: string): Claims {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Claims;
  } catch {
    // fall through
  }
  throw new PrivyTokenError(`${what}: malformed token`);
}

/** Verifies one Privy JWT (ES256, our key, issuer, audience, time) and returns its claims. */
function verifyJwt(token: string, config: PrivyConfig, what: string, now: number): Claims {
  if (typeof token !== "string" || token.length === 0) throw new PrivyTokenError(`${what}: malformed token`);
  if (Buffer.byteLength(token) > MAX_TOKEN_BYTES) throw new PrivyTokenError(`${what}: token too large`);
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw new PrivyTokenError(`${what}: malformed token`);
  const [h, p, sig] = parts;
  const header = decodeJson(h, what);
  if (header.alg !== "ES256") throw new PrivyTokenError(`${what}: unexpected algorithm`);
  const signature = Buffer.from(sig, "base64url");
  const valid = signature.length === 64 && verify("sha256", Buffer.from(`${h}.${p}`), { key: keyOf(config.verificationKey), dsaEncoding: "ieee-p1363" }, signature);
  if (!valid) throw new PrivyTokenError(`${what}: bad signature`);
  const claims = decodeJson(p, what);
  const nowS = Math.floor(now / 1000);
  if (claims.iss !== "privy.io") throw new PrivyTokenError(`${what}: wrong issuer`);
  const aud = claims.aud;
  if (!(aud === config.appId || (Array.isArray(aud) && aud.includes(config.appId)))) throw new PrivyTokenError(`${what}: wrong audience`);
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S <= nowS) throw new PrivyTokenError(`${what}: expired`);
  if (typeof claims.iat !== "number" || claims.iat > nowS + SKEW_S) throw new PrivyTokenError(`${what}: issued in the future`);
  if (typeof claims.sub !== "string" || !DID.test(claims.sub)) throw new PrivyTokenError(`${what}: bad subject`);
  return claims;
}

/** linked_accounts is a JSON string of a light version of the user's linked accounts (docs.privy.io, identity tokens).
 *  Its entry fields aren't documented there, so this reads only what it can check and drops everything else: an
 *  unknown shape gives no email and no wallets (the Owner step-up then fails closed), never a wrong one. */
function linkedAccounts(raw: unknown): { email: string | null; wallets: `0x${string}`[] } {
  let list: unknown;
  try {
    list = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { email: null, wallets: [] };
  }
  if (!Array.isArray(list)) return { email: null, wallets: [] };
  let email: string | null = null;
  const wallets = new Set<`0x${string}`>();
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const a = entry as Record<string, unknown>;
    if (a.type === "email" && typeof a.address === "string" && a.address.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(a.address)) {
      email ??= a.address.toLowerCase();
    }
    const evm = a.chain_type === undefined || a.chain_type === "ethereum";
    if (a.type === "wallet" && evm && a.wallet_client_type !== "privy" && typeof a.address === "string" && isAddress(a.address, { strict: false })) {
      wallets.add(a.address.toLowerCase() as `0x${string}`);
    }
  }
  return { email, wallets: [...wallets].sort() };
}

/** Both tokens verified and from the same Privy user, or PrivyTokenError. */
export function verifyPrivyTokens(accessToken: string, identityToken: string, config: PrivyConfig, now = Date.now()): PrivyUser {
  const access = verifyJwt(accessToken, config, "access token", now);
  const identity = verifyJwt(identityToken, config, "identity token", now);
  if (identity.sub !== access.sub) throw new PrivyTokenError("identity token: not the same user as the access token");
  const { email, wallets } = linkedAccounts(identity.linked_accounts);
  return { did: access.sub as string, sid: typeof access.sid === "string" && access.sid.length <= 200 ? access.sid : null, email, wallets };
}
