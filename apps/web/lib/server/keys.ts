// Server-only API keys (SRS FR-GW-6): pk_test_ (publishable) and sk_test_ (secret), test mode only (FR-GW-14).
// Only a SHA-256 of each key is stored and the key is shown once. authenticateKey() is the check claude-frontend's
// POST /api/v1/sessions uses for Bearer keys (FR-PAY-4).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, type Address } from "viem";
import { query } from "./db.ts";
import { HttpError, newId, signedInMerchant } from "./http.ts";

export type KeyKind = "pk" | "sk";
export const MAX_KEYS = 20; // live keys per merchant
const KEY_PATTERN = /^(pk|sk)_test_[A-Za-z0-9_-]{32}$/;
const sha256 = (key: string) => createHash("sha256").update(key).digest("hex");

export interface ApiKey {
  id: string;
  label: string;
  kind: KeyKind;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

type KeyRow = { id: string; label: string; kind: KeyKind; prefix: string; created_at: string; last_used_at: string | null };
const fromRow = (r: KeyRow): ApiKey => ({ id: r.id, label: r.label, kind: r.kind, prefix: r.prefix, createdAt: Number(r.created_at), lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at) });

/** A new key; `key` is returned here only, never again. */
export async function createKey(merchant: Address, label: string, kind: KeyKind, now = Date.now()): Promise<{ key: string; record: ApiKey }> {
  const owner = merchant.toLowerCase();
  const [{ n }] = await query<{ n: string }>("SELECT count(*)::text AS n FROM app_gw_keys WHERE merchant = $1 AND revoked_at IS NULL", [owner]);
  if (Number(n) >= MAX_KEYS) throw new HttpError(409, `You can have at most ${MAX_KEYS} keys. Revoke one first.`);
  const key = `${kind}_test_${randomBytes(24).toString("base64url")}`; // 24 bytes → 32 base64url chars
  const record: ApiKey = { id: newId("key"), label, kind, prefix: key.slice(0, 12), createdAt: now, lastUsedAt: null };
  await query(
    "INSERT INTO app_gw_keys (id, merchant, kind, label, prefix, key_hash, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [record.id, owner, kind, label, record.prefix, sha256(key), now],
  );
  return { key, record };
}

export async function listKeys(merchant: Address): Promise<ApiKey[]> {
  const rows = await query<KeyRow>(
    "SELECT id, label, kind, prefix, created_at::text, last_used_at::text FROM app_gw_keys WHERE merchant = $1 AND revoked_at IS NULL ORDER BY created_at DESC, id",
    [merchant.toLowerCase()],
  );
  return rows.map(fromRow);
}

/** True if this merchant had that live key. */
export async function revokeKey(merchant: Address, id: string, now = Date.now()): Promise<boolean> {
  const rows = await query("UPDATE app_gw_keys SET revoked_at = $3 WHERE id = $1 AND merchant = $2 AND revoked_at IS NULL RETURNING id", [id, merchant.toLowerCase(), now]);
  return rows.length === 1;
}

/** The merchant behind a request's `Authorization: Bearer <pk_test_|sk_test_…>`, or null (missing, malformed, unknown, revoked). */
export async function authenticateKey(request: Request, now = Date.now()): Promise<{ merchant: Address; kind: KeyKind; keyId: string } | null> {
  const auth = request.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!KEY_PATTERN.test(key)) return null;
  const hash = sha256(key);
  const rows = await query<{ id: string; merchant: string; kind: KeyKind; key_hash: string }>(
    "SELECT id, merchant, kind, key_hash FROM app_gw_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hash],
  );
  const row = rows[0];
  if (!row || !timingSafeEqual(Buffer.from(row.key_hash, "hex"), Buffer.from(hash, "hex"))) return null;
  await query("UPDATE app_gw_keys SET last_used_at = $2 WHERE id = $1", [row.id, now]);
  return { merchant: getAddress(row.merchant), kind: row.kind, keyId: row.id };
}

/** The merchant behind the dashboard cookie, or behind a live secret (sk_test_) key: what a shop's own server or setup
 *  script uses (AT-14). Publishable keys never manage the account. 401 otherwise. */
export async function merchantByCookieOrSecretKey(request: Request): Promise<Address> {
  try {
    return signedInMerchant(request);
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 401) throw err;
  }
  const key = await authenticateKey(request);
  if (key?.kind === "sk") return key.merchant;
  throw new HttpError(401, "Sign in to your merchant dashboard, or send your secret API key.");
}

export type Caller = { merchant: Address; via: "session" | "secret_key"; keyId: string | null };

/** Like merchantByCookieOrSecretKey, for the routes the assistant connector uses (batch 052, FR-GW-16 proposed), and it
 *  says which credential it was: 401 without a session or a live key, 403 for a publishable key (it is shipped to
 *  browsers, so it may never read or create merchant records). */
export async function callerMerchant(request: Request): Promise<Caller> {
  try {
    return { merchant: signedInMerchant(request), via: "session", keyId: null };
  } catch (err) {
    if (!(err instanceof HttpError) || err.status !== 401) throw err;
  }
  const key = await authenticateKey(request);
  if (!key) throw new HttpError(401, "Sign in to your merchant dashboard, or send a live secret API key (sk_test_…).");
  if (key.kind !== "sk") throw new HttpError(403, "A publishable key (pk_test_…) can't do this: use your secret key (sk_test_…), on your server only.");
  return { merchant: key.merchant, via: "secret_key", keyId: key.keyId };
}

export const keyJson = (k: ApiKey) => ({
  id: k.id,
  label: k.label,
  kind: k.kind,
  prefix: k.prefix,
  created_at: new Date(k.createdAt).toISOString(),
  last_used_at: k.lastUsedAt === null ? null : new Date(k.lastUsedAt).toISOString(),
});
