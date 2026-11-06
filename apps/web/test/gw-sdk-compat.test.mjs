// claude-contracts check (SRS FR-GW-7, AT-14 backend half): a webhook signed by our sender (lib/server/webhooks.ts)
// verifies with claude-sdk's receiver (packages/sdk constructEvent), and a tampered one doesn't. The sender keeps its
// own signer so the Next build doesn't pull files from outside apps/web; this test fails the moment the two drift.
// Run from apps/web: node --experimental-test-module-mocks --test test/gw-sdk-compat.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { SIGNATURE_HEADER, signWebhook } = await import("../lib/server/webhooks.ts");
const sdk = await import("../../../packages/sdk/index.ts");

const secret = "whsec_" + "k".repeat(43);
const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", created: 1_800_000_000, data: { id: "sess_1", amount: "25.00", link_id: "lnk_1", page_id: null } });

test("same header name as the SDK", () => {
  assert.equal(SIGNATURE_HEADER, sdk.SIGNATURE_HEADER);
});

test("our signature verifies with the SDK's constructEvent and yields the event", () => {
  const now = Math.floor(Date.now() / 1000);
  const event = sdk.constructEvent(body, signWebhook(body, secret, now), secret);
  assert.equal(event.type, "payment.succeeded");
  assert.equal(event.data.link_id, "lnk_1");
  assert.equal(signWebhook(body, secret, now), sdk.signWebhook(body, secret, now), "byte-identical headers");
});

test("a changed body, a wrong secret or an old timestamp is refused by the SDK", () => {
  const now = Math.floor(Date.now() / 1000);
  assert.throws(() => sdk.constructEvent(body.replace("25.00", "2.50"), signWebhook(body, secret, now), secret), sdk.WebhookSignatureError);
  assert.throws(() => sdk.constructEvent(body, signWebhook(body, secret, now), secret + "x"), sdk.WebhookSignatureError);
  assert.throws(() => sdk.constructEvent(body, signWebhook(body, secret, now - 3600), secret), sdk.WebhookSignatureError);
});
