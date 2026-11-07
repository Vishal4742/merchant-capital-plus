// Batch 050 (FR-PAY-15, FR-BIZ-6, FR-AUTH-1, FR-AUTH-2, DEP-3, NFR-8): Privy onboarding and authentication.
// Tests server-side Privy configuration, token verification, /api/auth/privy route handling, and SignIn UI integration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { serverPrivyConfig, privyAppId, privyConfig } = await import("../lib/privy-config.ts");
const { verifyPrivyToken } = await import("../lib/server/privy-auth.ts");
const { POST: privyAuthHandler } = await import("../app/api/auth/privy/route.ts");
const { readSession, SESSION_COOKIE } = await import("../lib/auth.ts");

const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const signInComponent = source("components/merchant/SignIn.tsx");

const TEST_APP_ID = "cmw57ezwm009e0gl6anp269do";
const TEST_APP_SECRET = "privy_app_secret_test1234567890abcdef";

test("serverPrivyConfig: extracts well-formed appId and appSecret; refuses missing or malformed", () => {
  const origAppId = process.env.PRIVY_APP_ID;
  const origPublicAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const origSecret = process.env.PRIVY_APP_SECRET;

  try {
    delete process.env.PRIVY_APP_ID;
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    delete process.env.PRIVY_APP_SECRET;
    assert.equal(serverPrivyConfig(), null, "null without credentials");

    process.env.PRIVY_APP_ID = "invalid_id!";
    process.env.PRIVY_APP_SECRET = TEST_APP_SECRET;
    assert.equal(serverPrivyConfig(), null, "null with malformed appId");

    process.env.PRIVY_APP_ID = TEST_APP_ID;
    process.env.PRIVY_APP_SECRET = "";
    assert.equal(serverPrivyConfig(), null, "null with blank secret");

    process.env.PRIVY_APP_ID = TEST_APP_ID;
    process.env.PRIVY_APP_SECRET = TEST_APP_SECRET;
    const cfg = serverPrivyConfig();
    assert.ok(cfg);
    assert.equal(cfg.appId, TEST_APP_ID);
    assert.equal(cfg.appSecret, TEST_APP_SECRET);
  } finally {
    if (origAppId) process.env.PRIVY_APP_ID = origAppId; else delete process.env.PRIVY_APP_ID;
    if (origPublicAppId) process.env.NEXT_PUBLIC_PRIVY_APP_ID = origPublicAppId; else delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    if (origSecret) process.env.PRIVY_APP_SECRET = origSecret; else delete process.env.PRIVY_APP_SECRET;
  }
});

test("privyConfig: landingHeader defaults to Pay with your wallet and accepts custom onboarding header", () => {
  const payConfig = privyConfig(null);
  assert.equal(payConfig.appearance.landingHeader, "Pay with your wallet");

  const onboardConfig = privyConfig(null, "Sign in to WhiteFlow");
  assert.equal(onboardConfig.appearance.landingHeader, "Sign in to WhiteFlow");
});

test("verifyPrivyToken: rejects blank tokens and network failures gracefully", async () => {
  assert.equal(await verifyPrivyToken(""), null);
  assert.equal(await verifyPrivyToken("   "), null);

  // Mock global fetch to simulate Privy API failure
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    assert.equal(await verifyPrivyToken("invalid-token"), null);

    globalThis.fetch = async () => {
      throw new Error("Network offline");
    };
    assert.equal(await verifyPrivyToken("some-token"), null);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("verifyPrivyToken: successfully extracts wallet and email from Privy user response", async () => {
  const origFetch = globalThis.fetch;
  const origAppId = process.env.PRIVY_APP_ID;
  const origSecret = process.env.PRIVY_APP_SECRET;
  process.env.PRIVY_APP_ID = TEST_APP_ID;
  process.env.PRIVY_APP_SECRET = TEST_APP_SECRET;
  const mockAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  let capturedHeaders = null;

  try {
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts?.headers;
      return new Response(
        JSON.stringify({
          id: "did:privy:cmw57user123",
          linked_accounts: [
            { type: "email", email: "merchant@example.com" },
            { type: "wallet", address: mockAddress, chain_type: "ethereum" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const user = await verifyPrivyToken("valid-privy-token");
    assert.ok(user);
    assert.equal(user.id, "did:privy:cmw57user123");
    assert.equal(user.walletAddress, mockAddress);
    assert.equal(user.email, "merchant@example.com");

    assert.ok(capturedHeaders);
    assert.equal(capturedHeaders["privy-id-token"], "valid-privy-token");
    assert.match(capturedHeaders["Authorization"], /^Basic /);
  } finally {
    globalThis.fetch = origFetch;
    if (origAppId) process.env.PRIVY_APP_ID = origAppId; else delete process.env.PRIVY_APP_ID;
    if (origSecret) process.env.PRIVY_APP_SECRET = origSecret; else delete process.env.PRIVY_APP_SECRET;
  }
});

test("/api/auth/privy: verifies token and sets session cookie", async () => {
  const origFetch = globalThis.fetch;
  const origSecret = process.env.AUTH_SECRET;
  const origAppId = process.env.PRIVY_APP_ID;
  const origPrivySecret = process.env.PRIVY_APP_SECRET;
  process.env.PRIVY_APP_ID = TEST_APP_ID;
  process.env.PRIVY_APP_SECRET = TEST_APP_SECRET;
  const mockAddress = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
  const authSecretKey = "a".repeat(32);
  process.env.AUTH_SECRET = authSecretKey;

  try {
    // Missing token
    const badReq = new Request("http://localhost:3000/api/auth/privy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const badRes = await privyAuthHandler(badReq);
    assert.equal(badRes.status, 400);

    // Mock successful verification
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "did:privy:user456",
          linked_accounts: [{ type: "wallet", address: mockAddress, chain_type: "ethereum" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const req = new Request("http://localhost:3000/api/auth/privy", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "test-token" }),
    });
    const res = await privyAuthHandler(req);
    assert.equal(res.status, 200);

    const data = await res.json();
    assert.equal(data.address, mockAddress);
    assert.equal(data.userId, "did:privy:user456");

    const cookieHeader = res.headers.get("set-cookie");
    assert.ok(cookieHeader);
    assert.match(cookieHeader, new RegExp(`${SESSION_COOKIE}=`));

    // Verify session cookie is valid
    const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    assert.ok(match);
    const sessionToken = decodeURIComponent(match[1]);
    assert.equal(readSession(sessionToken, authSecretKey), mockAddress);
  } finally {
    globalThis.fetch = origFetch;
    if (origSecret) process.env.AUTH_SECRET = origSecret; else delete process.env.AUTH_SECRET;
    if (origAppId) process.env.PRIVY_APP_ID = origAppId; else delete process.env.PRIVY_APP_ID;
    if (origPrivySecret) process.env.PRIVY_APP_SECRET = origPrivySecret; else delete process.env.PRIVY_APP_SECRET;
  }
});

test("SignIn component: includes Privy onboarding button and uses openPrivy", () => {
  assert.match(signInComponent, /import \{ privyAppId, walletConnectProjectId \} from "@\/lib\/privy-config"/);
  assert.match(signInComponent, /signInWithPrivy/);
  assert.match(signInComponent, /await import\("@\/components\/PrivyPay"\)/);
  assert.match(signInComponent, /openPrivy\(appId, wcId, "Sign in to WhiteFlow"\)/);
  assert.match(signInComponent, /Onboard with Privy/);
  assert.match(signInComponent, /Sign in with Privy/);
});
