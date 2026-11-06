// claude-frontend docs-drift checks for /docs (FR-GW-8): what lib/docs-reference.ts documents (and the page renders)
// is what the code does. Every path is a route file under app/api/v1 that exports the method, the currencies are the
// quotes module's, the limits are the code's constants, and every error message quoted is one the code sends.
// The limits only a request can show (rate limits, field lengths, webhook retries) are in docs-limits.test.mjs; the
// full endpoint pages' example replies and the test scenarios, from the real handlers, are in docs-endpoints.test.mjs.
// Here: each full endpoint page lists exactly the fields its route reads, each event documented as sent has a caller
// in the app (and one documented as not sent has none), and the checkout statuses are the SDK's.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// a file path on every OS (URL.pathname is "/P:/…" on Windows, which join() turned into "P:\P:\…"; batch 049)
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const { ENDPOINTS, RESOURCES, GROUPS, RATE_LIMITS, FX_CURRENCIES, LIMITS, ERRORS, EVENTS, CHECKOUT_STATUSES, TEST_SCENARIOS } = await import("../lib/docs-reference.ts");
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

/** Every .ts/.tsx source file under these folders, as [path, text]. */
const sourcesIn = (...dirs) =>
  dirs.flatMap((dir) =>
    readdirSync(join(ROOT, dir), { recursive: true })
      .filter((file) => /\.tsx?$/.test(file))
      .map((file) => [join(dir, file), readFileSync(join(ROOT, dir, file), "utf8")]),
  );
const namesOf = (params, where) => params.filter((p) => p.in === where).map((p) => p.name.toLowerCase()).sort();
const readsOf = (text, pattern) => [...new Set([...text.matchAll(pattern)].map((m) => m[1].toLowerCase()))].sort();

test("the reference is in three groups, your server's first, and every one of its endpoints has a full page", () => {
  assert.deepEqual(Object.keys(GROUPS), ["server", "dashboard", "hosted"]);
  assert.deepEqual([...new Set(RESOURCES.map((r) => r.group))], ["server", "dashboard", "hosted"], "grouped, in that order");
  const server = RESOURCES.filter((r) => r.group === "server").flatMap((r) => r.endpoints);
  assert.deepEqual(
    server.map((e) => `${e.method} ${e.path}`),
    ["POST /api/v1/sessions", "GET /api/v1/sessions/{id}", "GET /api/v1/payments"],
  );
  for (const e of server) assert.ok(e.detail, `${e.method} ${e.path} has a full page`);
  for (const e of ENDPOINTS.filter((e) => e.detail)) assert.equal(e.auth, "secret", `${e.path}: full pages are for the secret-key calls`);
});

test("each full endpoint page lists exactly the body fields, headers, query and path parameters its route reads", () => {
  for (const e of ENDPOINTS.filter((e) => e.detail)) {
    const text = readFileSync(routeFile(e.path), "utf8");
    const at = `${e.method} ${e.path}`;
    const { params } = e.detail;
    assert.deepEqual(namesOf(params, "body"), readsOf(text, /\bbody\.(\w+)/g), `${at}: body`);
    assert.deepEqual(namesOf(params, "header"), readsOf(text, /headers\.get\("([\w-]+)"\)/g), `${at}: headers (Authorization is read by shopCaller)`);
    assert.deepEqual(namesOf(params, "query"), readsOf(text, /(?:query|searchParams)\.get\("(\w+)"\)/g), `${at}: query`);
    assert.deepEqual(namesOf(params, "path"), readsOf(e.path, /\{(\w+)\}/g), `${at}: path`);
    assert.equal(new Set(params.map((p) => p.name)).size, params.length, `${at}: no parameter twice`);
    // the example only sends documented parameters, and every required one
    const sent = [...Object.keys(e.detail.body ?? {}), ...Object.keys(e.detail.headers ?? {})].map((n) => n.toLowerCase());
    const known = new Set(params.filter((p) => p.in === "body" || p.in === "header").map((p) => p.name.toLowerCase()));
    for (const name of sent) assert.ok(known.has(name), `${at}: the example sends ${name}, which isn't documented`);
    for (const p of params.filter((p) => p.required && p.in === "body")) assert.ok(sent.includes(p.name.toLowerCase()), `${at}: the example leaves out ${p.name}`);
  }
});

test("each webhook event documented as sent has a caller in the app, and one documented as not sent has none", () => {
  const events = readFileSync(join(ROOT, "lib/server/events.ts"), "utf8");
  // the event types lib/server/events.ts defines are the ones documented
  const defined = events.match(/type EventType = ([^;]+);/)[1].match(/"[\w.]+"/g).map((t) => t.slice(1, -1));
  assert.deepEqual(EVENTS.map((e) => e.type).sort(), [...defined].sort());
  // which exported function sends which type
  const senders = new Map([...events.matchAll(/export async function (\w+)\([\s\S]*?\n}/g)].flatMap(([body, name]) => [...body.matchAll(/"(payment\.\w+)"/g)].map((m) => [m[1], name])));
  const app = sourcesIn("app", "lib", "components").filter(([path]) => path !== join("lib", "server", "events.ts"));
  // a use outside an import line: the default argument in lib/announce-paid.ts counts, a test file never does
  const callers = (name) => app.filter(([, text]) => text.split("\n").some((line) => !/^\s*import\b/.test(line) && new RegExp(`\\b${name}\\b`).test(line))).map(([path]) => path);
  for (const { type, sent } of EVENTS) {
    const sender = senders.get(type);
    assert.ok(sender, `no function in lib/server/events.ts sends ${type}`);
    if (sent) assert.ok(callers(sender).length > 0, `${type} is documented as sent, but nothing in the app calls ${sender}`);
    else assert.deepEqual(callers(sender), [], `${type} is documented as not sent yet, but ${sender} is called: document it`);
  }
  // both are sent since claude-contracts' refunds/sync (lib/server/refunds.ts) calls onRefund in production
  assert.deepEqual(EVENTS.filter((e) => e.sent).map((e) => e.type), ["payment.succeeded", "payment.refunded"]);
});

test("the checkout statuses are the SDK's, in the order a checkout moves", () => {
  const sdkText = readFileSync(new URL("../../../packages/sdk/index.ts", import.meta.url), "utf8");
  const union = sdkText.match(/status: ("\w+"(?: \| "\w+")+);/)[1].match(/\w+/g);
  assert.deepEqual(CHECKOUT_STATUSES.map((s) => s.status), union);
});

test("every test scenario message is one the code sends, word for word, and each id is unique", () => {
  const code = sourcesIn("app/api", "lib").filter(([path]) => !path.endsWith("docs-reference.ts")).map(([, text]) => text);
  // "This payment link is ${status}." is a template: the scenario quotes it filled in
  const filled = code.map((text) => text.replaceAll("This payment link is ${status}.", "This payment link is paid."));
  for (const { id, messages = [] } of TEST_SCENARIOS) {
    for (const message of messages) assert.ok(filled.some((text) => text.includes(message)), `${id}: "${message}" isn't in the code`);
  }
  assert.equal(new Set(TEST_SCENARIOS.map((t) => t.id)).size, TEST_SCENARIOS.length);
});

test("every error status says what to do", () => {
  for (const { status, fix } of ERRORS) assert.ok(fix && fix.length > 10, `${status} has a fix`);
});
