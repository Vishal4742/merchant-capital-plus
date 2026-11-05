// Tester walk, batch 004 round 2: every changed page at one width and colour scheme, in a real Chromium.
// Usage: SID=<checkout id from POST /api/v1/sessions> node walk.mjs <width> <light|dark> <out.json>
// Per visit: a fresh context (cold cache), CSP violations, requests to other origins, the FR-PAY-7 word scan on the
// pay pages, horizontal overflow, console errors, and a full-page shot in ../shots/.
// Money: "pending" and "paid" are browser-side only (the pay POST is aborted or answered by Playwright and never
// reaches our server). "error" is one real attempt: the local relayer refuses paySale with 400, nothing is sent.
// Reads no .env value; the guest key is created fresh in each throwaway context and never printed.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const [widthArg, scheme, out] = process.argv.slice(2);
const width = Number(widthArg);
const BASE = "http://localhost:3100";
const SHOTS = new URL("../shots/", import.meta.url).pathname;
const SID = process.env.SID;
const CRYPTO = /\b(sign|gas|wallet|whitechain|chain)\b/i;
const mobile = width < 500;

const browser = await chromium.launch();
const results = [];

async function visit(name, path, { payRoute, act, waitMs = 2500, scan = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 812 : 900 },
    colorScheme: scheme,
    ...(mobile ? { hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : {}),
  });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push({ directive: e.violatedDirective, blocked: e.blockedURI }));
  });
  const requests = [];
  const payPosts = [];
  ctx.on("request", (r) => {
    requests.push({ url: r.url(), type: r.resourceType() });
    if (r.method() === "POST" && /\/api\/v1\/sessions\/[^/]+\/pay$/.test(r.url())) payPosts.push(JSON.parse(r.postData() ?? "{}"));
  });
  if (payRoute) await ctx.route("**/api/v1/sessions/*/pay", payRoute);
  const page = await ctx.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
  const res = await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(waitMs);
  const actResult = act ? await act(page) : undefined;
  const text = await page.innerText("body");
  const offOrigin = requests.filter((r) => !r.url.startsWith(BASE) && !/^(data|blob):/.test(r.url));
  const r = {
    name,
    path: path.replace(SID ?? "\u0000", "<SID>"),
    status: res?.status(),
    title: await page.title(),
    robots: await page.locator('meta[name="robots"]').getAttribute("content").catch(() => null),
    cspHeader: Boolean(res?.headers()["content-security-policy"]),
    cspViolations: await page.evaluate(() => window.__csp),
    offOriginRequests: offOrigin.map((r) => r.url.slice(0, 80)),
    scriptsOffOrigin: offOrigin.filter((r) => r.type === "script").length,
    scriptCount: requests.filter((r) => r.type === "script").length,
    cryptoWord: scan ? (CRYPTO.exec(text)?.[0] ?? null) : "n/a (not a pay page)",
    scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    holdButtons: await page.getByRole("button", { name: /Hold to pay/ }).count(),
    payPosts: payPosts.length,
    consoleErrors,
    text: text.replace(/\s+/g, " ").trim().slice(0, 400),
    ...(actResult ?? {}),
  };
  await page.screenshot({ path: `${SHOTS}${name}-${width}-${scheme}.png`, fullPage: true });
  results.push(r);
  console.log(JSON.stringify({ name: r.name, status: r.status, csp: r.cspViolations.length, offOrigin: r.offOriginRequests.length, word: r.cryptoWord, sw: r.scrollWidth, buttons: r.holdButtons, posts: r.payPosts, errors: r.consoleErrors.length }));
  await ctx.close();
}

// keyboard press on the HoldButton: confirms at once (no 900 ms hold needed)
const pressPay = async (page, waitMs = 3000) => {
  await page.getByRole("button", { name: /Hold to pay/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(waitMs);
  return { alerts: await page.getByRole("alert").allInnerTexts() };
};
const confirmingInfo = async (p) => {
  const st = p.getByRole("status");
  const panel = p.locator('[role="status"]', { hasText: "Confirming" });
  const pill = panel.getByText("Confirming", { exact: true });
  return {
    statusCount: await panel.count(),
    panelText: (await panel.first().innerText().catch(() => "")).replace(/\s+/g, " "),
    pillColor: await pill.first().evaluate((e) => getComputedStyle(e).color).catch(() => null),
    holdButtons: await p.getByRole("button", { name: /Hold to pay|Paying/ }).count(),
    checkAgain: await p.getByRole("button", { name: "Check again" }).count(),
    redText: await panel.locator("p").first().evaluate((e) => getComputedStyle(e).color).catch(() => null),
  };
};
const refuse400 = (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "The payment didn't go through. Nothing was charged." }) });

await visit("checkout-ready", `/checkout/${SID}`, { scan: true });
await visit("checkout-confirming-dropped", `/checkout/${SID}`, { scan: true, payRoute: (r) => r.abort("connectionreset"), act: async (p) => { await pressPay(p); return { c: await confirmingInfo(p) }; } });
await visit("checkout-confirming-504", `/checkout/${SID}`, { scan: true, payRoute: (r) => r.fulfill({ status: 504, contentType: "application/json", body: "{}" }), act: async (p) => { await pressPay(p); return { c: await confirmingInfo(p) }; } });
await visit("checkout-confirming-500", `/checkout/${SID}`, { scan: true, payRoute: (r) => r.fulfill({ status: 500, contentType: "application/json", body: "{}" }), act: async (p) => { await pressPay(p); return { c: await confirmingInfo(p) }; } });
await visit("checkout-confirming-409", `/checkout/${SID}`, { scan: true, payRoute: (r) => r.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "x" }) }), act: async (p) => { await pressPay(p); return { c: await confirmingInfo(p) }; } });
// Check again = a full reload (a document request for the same URL)
await visit("checkout-confirming-checkagain", `/checkout/${SID}`, {
  scan: true,
  payRoute: (r) => r.abort("connectionreset"),
  act: async (p) => {
    await pressPay(p);
    let docReq = 0;
    p.on("request", (rq) => rq.resourceType() === "document" && docReq++);
    await p.evaluate(() => (window.__marker = 1));
    await p.getByRole("button", { name: "Check again" }).click();
    await p.waitForLoadState("load");
    await p.waitForTimeout(1500);
    return { docReqAfterClick: docReq, markerSurvived: await p.evaluate(() => window.__marker === 1), buttonsAfter: await p.getByRole("button", { name: /Hold to pay/ }).count() };
  },
});
await visit("checkout-expired-410route", `/checkout/${SID}`, { scan: true, payRoute: (r) => r.fulfill({ status: 410, contentType: "application/json", body: JSON.stringify({ error: "expired" }) }), act: async (p) => { await pressPay(p); return { holdButtons2: await p.getByRole("button", { name: /Hold to pay|Paying/ }).count(), confirmingPanels: await p.locator('[role="status"]', { hasText: "Confirming" }).count() }; } });
if (process.env.EXP) await visit("checkout-expired-natural", `/checkout/${process.env.EXP}`, { scan: true, act: async (p) => ({ holdButtons2: await p.getByRole("button", { name: /Hold to pay|Paying/ }).count(), confirmingPanels: await p.locator('[role="status"]', { hasText: "Confirming" }).count() }) });
await visit("checkout-paid", `/checkout/${SID}`, {
  scan: true,
  payRoute: (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ receiptId: SID, txHash: `0x${"ab".repeat(32)}` }) }),
  act: async (p) => ({ ...(await pressPay(p)), receiptLink: await p.getByRole("link", { name: "View receipt" }).getAttribute("href").catch(() => null), h1: await p.locator("h1").allInnerTexts() }),
});
// two attempts in one tab: fresh salt each time
await visit("checkout-two-attempts", `/checkout/${SID}`, {
  scan: true, payRoute: refuse400,
  act: async (p) => { await pressPay(p, 1500); await pressPay(p, 1500); return {}; },
});
if (scheme === "light") await visit("checkout-error-real", `/checkout/${SID}`, { scan: true, act: (p) => pressPay(p, 5000) });
await visit("checkout-notfound", "/checkout/00000000-0000-0000-0000-000000000000", { scan: true, act: async (p) => ({ h1: await p.locator("h1").allInnerTexts(), homeLink: await p.getByRole("link", { name: /Go to Merchant Capital/ }).getAttribute("href"), linkH: (await p.getByRole("link", { name: /Go to Merchant Capital/ }).boundingBox())?.height }) });
await visit("receipt-notfound", `/r/00000000-0000-0000-0000-000000000000`, { scan: true, act: async (p) => ({ h1: await p.locator("h1").allInnerTexts(), homeLink: await p.getByRole("link", { name: /Go to Merchant Capital/ }).getAttribute("href") }) });
await visit("receipt-unpaid-real-id", `/r/${SID}`, { scan: true });
await visit("home", "/", { waitMs: 3500 });
await visit("merchant-signed-out", "/merchant");
if (width === 1440) await visit("proofs", "/proofs", { waitMs: 1500 });

writeFileSync(out, JSON.stringify(results, null, 1));
await browser.close();
