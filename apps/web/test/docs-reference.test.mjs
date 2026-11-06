// claude-frontend docs-drift checks for /docs (FR-GW-8): what lib/docs-reference.ts documents (and the page renders)
// is what the code does. Every path is a route file under app/api/v1 that exports the method, the currencies are the
// quotes module's, the limits are the code's constants, and every error message quoted is one the code sends.
// The limits only a request can show (rate limits, field lengths, webhook retries) are in docs-limits.test.mjs.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const { ENDPOINTS, RESOURCES, RATE_LIMITS, FX_CURRENCIES, LIMITS, ERRORS } = await import("../lib/docs-reference.ts");
const { CURRENCIES, MAX_PAYMENT, MIN_PAYMENT, HttpError } = await import("../lib/server/http.ts");
const { BANDS, QUOTE_TTL_MS, RATE_CACHE_MS, toUsdtUnits } = await import("../lib/server/quotes.ts");
const { MAX_KEYS } = await import("../lib/server/keys.ts");
const { MAX_LIST } = await import("../lib/server/links.ts");
const { rangeOf } = await import("../lib/server/reports.ts");
const { SESSION_TTL_MS, BAD_RETURN_URL, webUrl } = await import("../lib/sessions.ts");
const { formatUsdt } = await import("../lib/usdt.ts");
const { signWebhook } = await import("../lib/server/webhooks.ts");
const sdk = await import("../../../packages/sdk/index.ts");

const MINUTE_MS = 60_000;
/** "/api/v1/sessions/{id}/pay" → app/api/v1/sessions/[id]/pay/route.ts */
const routeFile = (path) => join(ROOT, "app", path.replace(/\{(\w+)\}/g, "[$1]"), "route.ts");
const exportsMethod = (text, method) => new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${method}\\b`).test(text);

test("every documented endpoint is a route file under app/api/v1 that exports its method", () => {
  assert.ok(ENDPOINTS.length >= 30, "the reference lists the API");
  for (const { method, path } of ENDPOINTS) {
    assert.match(path, /^\/api\/v1\//, path);
    const file = routeFile(path);
    assert.ok(existsSync(file), `${method} ${path}: no ${file.slice(ROOT.length)}`);
    assert.ok(exportsMethod(readFileSync(file, "utf8"), method), `${path} doesn't export ${method}`);
  }
});

test("no endpoint is listed twice, and every resource has a unique id", () => {
  const keys = ENDPOINTS.map((e) => `${e.method} ${e.path}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(RESOURCES.map((r) => r.id)).size, RESOURCES.length);
});

test("every rate-limited endpoint is one the reference documents", () => {
  const documented = new Set(ENDPOINTS.map((e) => `${e.method} ${e.path}`));
  for (const { endpoints } of RATE_LIMITS) for (const e of endpoints) assert.ok(documented.has(`${e.method} ${e.path}`), `${e.method} ${e.path}`);
});

test("the currencies listed are the gateway's, in its order: USDT, USD at 1:1, and the five the quotes module prices", () => {
  assert.deepEqual(
    FX_CURRENCIES.map((c) => c.code),
    [...CURRENCIES],
  );
  const live = FX_CURRENCIES.filter((c) => c.code !== "USDT" && c.code !== "USD").map((c) => c.code);
  assert.deepEqual([...live].sort(), Object.keys(BANDS).sort());
});

test("the payment limits are MerchantPay's and the testnet cap: 1.00 to 1,000.00 USDT", () => {
  assert.equal(LIMITS.minPaymentUsdt, formatUsdt(MIN_PAYMENT));
  assert.equal(LIMITS.maxPaymentUsdt, formatUsdt(MAX_PAYMENT));
});

test("the checkout lifetime, quote lock and rate cache are the code's", () => {
  assert.equal(LIMITS.checkoutMinutes * MINUTE_MS, SESSION_TTL_MS);
  assert.equal(LIMITS.quoteLockMinutes * MINUTE_MS, QUOTE_TTL_MS);
  assert.equal(LIMITS.rateCacheMinutes * MINUTE_MS, RATE_CACHE_MS);
});

test("each FX band is ±15% around its rate, and AED's is its 3.6725 peg ±1%", () => {
  const near = (actual, expected) => Math.abs(actual - expected) < 0.0005;
  for (const [currency, [low, high]] of Object.entries(BANDS)) {
    const mid = (low + high) / 2;
    const percent = currency === "AED" ? LIMITS.aedPegPercent : LIMITS.fxBandPercent;
    assert.ok(near(high / mid - 1, percent / 100) && near(1 - low / mid, percent / 100), `${currency} ${low}..${high}`);
  }
  assert.ok(Math.abs((BANDS.AED[0] + BANDS.AED[1]) / 2 - 3.6725) < 1e-9);
});

test("the FX example rounds up to the cent: 20.00 EUR at 0.88875 per USD is 22.51 USDT", () => {
  assert.equal(formatUsdt(toUsdtUnits("20.00", { num: 88_875n, den: 100_000n })), "22.51");
});

test("the key, list and report limits are the code's", () => {
  assert.equal(LIMITS.keysMax, MAX_KEYS);
  assert.equal(LIMITS.listMax, MAX_LIST);
  const report = (from, to) => rangeOf(new Request(`http://localhost/api/v1/reports?from=${from}&to=${to}`));
  assert.equal(report("2026-01-01", "2026-04-02").to, "2026-04-02"); // 92 days, inclusive
  assert.throws(() => report("2026-01-01", "2026-04-03"), (e) => e instanceof HttpError && e.message === `A report covers at most ${LIMITS.reportDaysMax} days.`);
});

test(`returnUrl: http or https, at most ${LIMITS.returnUrlMax} characters`, () => {
  const base = "https://shop.example/";
  assert.equal(webUrl(base + "x".repeat(LIMITS.returnUrlMax - base.length)).length, LIMITS.returnUrlMax);
  assert.equal(webUrl(base + "x".repeat(LIMITS.returnUrlMax - base.length + 1)), null);
  assert.equal(webUrl("ftp://shop.example/"), null);
  assert.ok(BAD_RETURN_URL.includes(`at most ${LIMITS.returnUrlMax} characters`));
});

test(`the SDK accepts a webhook up to ${LIMITS.webhookToleranceSeconds} s old and refuses an older one`, () => {
  const secret = "whsec_" + "d".repeat(43), body = '{"id":"evt_1","type":"payment.succeeded","created":1,"data":{"test":true}}';
  const at = (age) => signWebhook(body, secret, Math.floor(Date.now() / 1000) - age);
  assert.equal(sdk.constructEvent(body, at(LIMITS.webhookToleranceSeconds - 5), secret).id, "evt_1");
  assert.throws(() => sdk.constructEvent(body, at(LIMITS.webhookToleranceSeconds + 5), secret), sdk.WebhookSignatureError);
});

test("every error message the docs quote is one the code sends, word for word", () => {
  const sources = ["app/api", "lib"].flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((file) => file.endsWith(".ts") && !file.endsWith("docs-reference.ts"))
      .map((file) => readFileSync(join(ROOT, dir, file), "utf8")),
  );
  const statuses = ERRORS.map((e) => e.status);
  assert.deepEqual(statuses, [...statuses].sort((a, b) => a - b), "in status order");
  for (const { status, examples } of ERRORS) {
    for (const message of examples) assert.ok(sources.some((text) => text.includes(message)), `${status}: "${message}" isn't in the code`);
  }
});
