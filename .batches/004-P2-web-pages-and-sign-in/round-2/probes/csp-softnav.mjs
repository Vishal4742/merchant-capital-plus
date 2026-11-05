// Tester probe, batch 004 round 1: is /checkout under its CSP when reached by Next's client-side navigation from the
// home page ("Try a checkout")? Test: fetch() to another origin. Under the CSP (connect-src 'self') the browser blocks
// it and fires securitypolicyviolation before any request leaves; without it the request goes out (routed to a local
// 204 here, so nothing reaches the internet). Prints only booleans and counts.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const BASE = "http://localhost:3100";
const browser = await chromium.launch();
const ctx = await browser.newContext();
let outbound = 0;
await ctx.route("https://csp-probe.example/**", (r) => { outbound++; return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } }); });
const page = await ctx.newPage();
const probe = async () => {
  const before = outbound;
  const v = await page.evaluate(async () => {
    let violations = 0;
    const on = () => violations++;
    document.addEventListener("securitypolicyviolation", on);
    let ok = false;
    try { await fetch("https://csp-probe.example/x"); ok = true; } catch {}
    await new Promise((r) => setTimeout(r, 300));
    document.removeEventListener("securitypolicyviolation", on);
    return { fetchOk: ok, violations };
  });
  return { ...v, requestLeft: outbound > before };
};
await page.goto(`${BASE}/`);
const home = await probe();
await page.getByRole("button", { name: "Try a checkout" }).click();
await page.waitForURL(/\/checkout\//);
await page.waitForTimeout(1500);
const softNav = await probe();
await page.reload();
await page.waitForTimeout(1500);
const fullLoad = await probe();
console.log(JSON.stringify({ home, checkoutAfterSoftNav: softNav, checkoutAfterFullLoad: fullLoad }));
await browser.close();
