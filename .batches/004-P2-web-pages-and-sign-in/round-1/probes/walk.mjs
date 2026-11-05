// Tester walk, batch 004 round 1: every changed page at one width and colour scheme, in a real Chromium.
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
const pressPay = async (page, waitMs = 4000) => {
  await page.getByRole("button", { name: /Hold to pay/ }).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(waitMs);
  return { alerts: await page.getByRole("alert").allInnerTexts() };
};

await visit("home", "/", { waitMs: 3500 });
await visit("checkout-ready", `/checkout/${SID}`, { scan: true });
await visit("checkout-pending-dropped", `/checkout/${SID}`, { scan: true, payRoute: (route) => route.abort("connectionreset"), act: (p) => pressPay(p) });
await visit("checkout-pending-504", `/checkout/${SID}`, {
  scan: true,
  payRoute: (route) => route.fulfill({ status: 504, contentType: "application/json", body: JSON.stringify({ error: "We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes." }) }),
  act: (p) => pressPay(p),
});
await visit("checkout-paid", `/checkout/${SID}`, {
  scan: true,
  payRoute: (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ receiptId: SID, txHash: `0x${"ab".repeat(32)}` }) }),
  act: async (p) => ({ ...(await pressPay(p)), receiptLink: await p.getByRole("link", { name: "View receipt" }).getAttribute("href").catch(() => null) }),
});
if (scheme === "light") await visit("checkout-error-real", `/checkout/${SID}`, { scan: true, act: (p) => pressPay(p, 6000) });
await visit("checkout-unknown", "/checkout/00000000-0000-0000-0000-000000000000", { scan: true });
await visit("receipt-unpaid", `/r/${SID}`, { scan: true });
await visit("merchant-signed-out", "/merchant");
if (width === 1440) await visit("proofs", "/proofs", { waitMs: 1500 });

writeFileSync(out, JSON.stringify(results, null, 1));
await browser.close();
