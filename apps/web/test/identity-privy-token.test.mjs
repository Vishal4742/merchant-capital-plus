// Batch 050 (FR-BIZ-6 v3.1): the server verifies Privy's ES256 access and identity tokens itself (node:crypto, no new
// dependency). Real tokens are minted here with a throwaway P-256 key standing in for Privy's signing key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";

const { verifyPrivyTokens, PrivyTokenError, privyConfig } = await import("../lib/server/privy-token.ts");

const APP_ID = "clabcdefghijklmnopqrstuvw";
const DID = "did:privy:cm1abcdefghijklmnop";
const NOW = 1_800_000_000_000;
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const PEM = publicKey.export({ type: "spki", format: "pem" });
const config = { appId: APP_ID, verificationKey: PEM };

const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
function jwt(claims, { header = { alg: "ES256", typ: "JWT" }, key = privateKey } = {}) {
  const input = `${b64(header)}.${b64(claims)}`;
  const sig = sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}
const s = (ms) => Math.floor(ms / 1000);
const access = (over = {}) => jwt({ iss: "privy.io", aud: APP_ID, sub: DID, sid: "sess_1", iat: s(NOW) - 60, exp: s(NOW) + 3600, ...over });
const WALLET = "0x1111111111111111111111111111111111111111";
const accounts = [
  { type: "email", address: "Owner@Example.com" },
  { type: "wallet", address: WALLET.toUpperCase().replace("0X", "0x"), chain_type: "ethereum", wallet_client_type: "metamask" },
  { type: "wallet", address: "0x2222222222222222222222222222222222222222", chain_type: "ethereum", wallet_client_type: "privy" }, // embedded: ignored
  { type: "wallet", address: "So1anaAddr", chain_type: "solana" }, // not EVM: ignored
  { type: "phone", number: "+1" },
];
const identity = (over = {}) => jwt({ iss: "privy.io", aud: APP_ID, sub: DID, iat: s(NOW) - 60, exp: s(NOW) + 3600, linked_accounts: JSON.stringify(accounts), ...over });

const rejects = (fn, re) => assert.throws(fn, (e) => e instanceof PrivyTokenError && re.test(e.message));

test("a valid access + identity token pair gives the DID, session id, verified email and external EVM wallets only", () => {
  const user = verifyPrivyTokens(access(), identity(), config, NOW);
  assert.deepEqual(user, { did: DID, sid: "sess_1", email: "owner@example.com", wallets: [WALLET] });
});

test("unknown linked_accounts shapes yield no wallets and no email (fail closed), never an error that leaks the token", () => {
  for (const linked of ["not json", JSON.stringify({ a: 1 }), JSON.stringify([{ type: "wallet" }, { type: "wallet", address: "0xzz" }]), undefined]) {
    const user = verifyPrivyTokens(access(), identity({ linked_accounts: linked }), config, NOW);
    assert.deepEqual([user.email, user.wallets], [null, []]);
  }
});

test("alg must be exactly ES256: none, HS256 and a missing alg are refused", () => {
  rejects(() => verifyPrivyTokens(jwt({ iss: "privy.io", aud: APP_ID, sub: DID, iat: s(NOW), exp: s(NOW) + 60 }, { header: { alg: "none" } }), identity(), config, NOW), /algorithm/);
  rejects(() => verifyPrivyTokens(jwt({ iss: "privy.io" }, { header: { alg: "HS256" } }), identity(), config, NOW), /algorithm/);
  rejects(() => verifyPrivyTokens(jwt({ iss: "privy.io" }, { header: { typ: "JWT" } }), identity(), config, NOW), /algorithm/);
});

test("a token signed by another key is refused", () => {
  const other = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  rejects(() => verifyPrivyTokens(jwt({ iss: "privy.io", aud: APP_ID, sub: DID, iat: s(NOW), exp: s(NOW) + 60 }, { key: other }), identity(), config, NOW), /signature/);
  rejects(() => verifyPrivyTokens(access(), jwt({ iss: "privy.io", aud: APP_ID, sub: DID, iat: s(NOW), exp: s(NOW) + 60 }, { key: other }), config, NOW), /signature/);
});

test("issuer, audience, expiry, issued-in-the-future and subject format are checked on both tokens", () => {
  rejects(() => verifyPrivyTokens(access({ iss: "evil.io" }), identity(), config, NOW), /issuer/);
  rejects(() => verifyPrivyTokens(access({ aud: "another-app-id-0000000000" }), identity(), config, NOW), /audience/);
  rejects(() => verifyPrivyTokens(access({ exp: s(NOW) - 31 }), identity(), config, NOW), /expired/);
  rejects(() => verifyPrivyTokens(access({ iat: s(NOW) + 31 }), identity(), config, NOW), /future/);
  rejects(() => verifyPrivyTokens(access({ sub: "0x1111111111111111111111111111111111111111" }), identity(), config, NOW), /subject/);
  rejects(() => verifyPrivyTokens(access(), identity({ exp: s(NOW) - 31 }), config, NOW), /expired/);
  rejects(() => verifyPrivyTokens(access(), identity({ aud: "x" }), config, NOW), /audience/);
  assert.equal(verifyPrivyTokens(access({ exp: s(NOW) - 29 }), identity(), config, NOW).did, DID, "30 s clock skew allowed");
});

test("the identity token must belong to the same Privy user as the access token", () => {
  rejects(() => verifyPrivyTokens(access(), identity({ sub: "did:privy:someoneelse0000000" }), config, NOW), /same user/);
});

test("malformed or oversized tokens are refused before any crypto", () => {
  rejects(() => verifyPrivyTokens("a.b", identity(), config, NOW), /malformed/);
  rejects(() => verifyPrivyTokens("", identity(), config, NOW), /malformed/);
  rejects(() => verifyPrivyTokens(`${access()}${"a".repeat(5000)}`, identity(), config, NOW), /too large/);
  rejects(() => verifyPrivyTokens(access(), "x.y.z", config, NOW), /malformed/);
});

test("privyConfig: the app id and verification key come from the environment; missing or malformed → null (sign-in off)", () => {
  assert.equal(privyConfig({}), null);
  assert.equal(privyConfig({ NEXT_PUBLIC_PRIVY_APP_ID: APP_ID }), null);
  assert.equal(privyConfig({ NEXT_PUBLIC_PRIVY_APP_ID: "bad id!", PRIVY_VERIFICATION_KEY: PEM }), null);
  assert.equal(privyConfig({ NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_VERIFICATION_KEY: "not a key" }), null);
  assert.deepEqual(privyConfig({ NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_VERIFICATION_KEY: PEM }), { appId: APP_ID, verificationKey: PEM.trim() });
  // dashboards and env editors often store the PEM with literal \n
  assert.deepEqual(privyConfig({ NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_VERIFICATION_KEY: PEM.replaceAll("\n", "\\n") }).appId, APP_ID);
});

test("round 2 (L5): a verification key on any curve but P-256 is refused (ES256 is P-256 only)", () => {
  for (const namedCurve of ["secp256k1", "P-384"]) {
    const pem = generateKeyPairSync("ec", { namedCurve }).publicKey.export({ type: "spki", format: "pem" });
    assert.equal(privyConfig({ NEXT_PUBLIC_PRIVY_APP_ID: APP_ID, PRIVY_VERIFICATION_KEY: pem }), null, namedCurve);
  }
});
