// Tester round 2: "Try a checkout" (/) and "Open a test checkout" (/merchant, signed in with an in-memory throwaway key)
// are full document loads: POST /api/demo-checkout -> 303 -> document GET /checkout/<id>, and the CSP then blocks a cross-origin fetch.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const webRequire = createRequire("/Users/vg890/ethglobal/apps/web/package.json");
const { generatePrivateKey, privateKeyToAccount } = webRequire("viem/accounts");
const account = privateKeyToAccount(generatePrivateKey());
const BASE = "http://localhost:3100";
const browser = await chromium.launch();
const out = {};
async function run(name, start, click) {
  const ctx = await browser.newContext();
  await ctx.exposeFunction("__s", (hex) => account.signMessage({ message: { raw: hex } }));
  await ctx.addInitScript((a) => { window.ethereum = { request: async ({ method, params }) => method === "personal_sign" ? window.__s(params[0]) : method === "eth_chainId" ? "0x752" : [a], on() {}, removeListener() {} }; }, account.address);
  let outbound = 0;
  await ctx.route("https://csp-probe.example/**", (r) => { outbound++; return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }); });
  const page = await ctx.newPage();
  const log = [];
  page.on("response", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/demo-checkout" || (r.request().resourceType() === "document" && u.pathname.startsWith("/checkout/"))) log.push({ method: r.request().method(), path: u.pathname.replace(/[0-9a-f-]{36}/, "<id>"), type: r.request().resourceType(), status: r.status(), csp: Boolean(r.headers()["content-security-policy"]) }); });
  await page.goto(BASE + start);
  await page.evaluate(() => (window.__marker = 1));
  await click(page);
  await page.waitForURL(/\/checkout\//, { timeout: 15000 });
  await page.waitForTimeout(1500);
  const v = await page.evaluate(async () => { let n = 0; const on = () => n++; document.addEventListener("securitypolicyviolation", on); let ok = false; try { await fetch("https://csp-probe.example/x"); ok = true; } catch {} await new Promise((r) => setTimeout(r, 300)); return { fetchOk: ok, violations: n, markerSurvived: window.__marker === 1 }; });
  out[name] = { log, ...v, requestLeft: outbound > 0 };
  await ctx.close();
}
await run("home Try a checkout", "/", (p) => p.getByRole("button", { name: "Try a checkout" }).click());
await run("merchant Open a test checkout", "/merchant", async (p) => { await p.getByRole("button", { name: "Sign in with your wallet" }).click(); await p.getByText("Signed in as").waitFor({ timeout: 15000 }); await p.getByRole("button", { name: "Open a test checkout" }).click(); });
console.log(JSON.stringify(out, null, 1));
await browser.close();
