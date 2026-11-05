// Tester probe, batch 004 round 1: the expired checkout state, reached naturally (the session was created by
// POST /api/v1/sessions more than 30 min earlier; nothing faked). Also checks the 404 pages' robots meta in the DOM.
// Usage: SID=<expired checkout id> node expired.mjs <out.json>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const BASE = "http://localhost:3100";
const SHOTS = new URL("../shots/", import.meta.url).pathname;
const SID = process.env.SID;
const [out] = process.argv.slice(2);
const CRYPTO = /\b(sign|gas|wallet|whitechain|chain)\b/i;
const browser = await chromium.launch();
const res = [];
for (const width of [375, 1440]) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 812 : 900 }, colorScheme: scheme });
    await ctx.addInitScript(() => { window.__csp = 0; document.addEventListener("securitypolicyviolation", () => window.__csp++); });
    const reqs = [];
    ctx.on("request", (r) => reqs.push(r.url()));
    const page = await ctx.newPage();
    const errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 160)));
    await page.goto(`${BASE}/checkout/${SID}`, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const text = (await page.innerText("body")).replace(/\s+/g, " ").trim();
    res.push({
      width, scheme,
      alert: (await page.getByRole("alert").allInnerTexts()).filter(Boolean),
      holdButtons: await page.getByRole("button", { name: /Hold to pay/ }).count(),
      cryptoWord: CRYPTO.exec(text)?.[0] ?? null,
      offOrigin: reqs.filter((u) => !u.startsWith(BASE) && !/^(data|blob):/.test(u)).length,
      csp: await page.evaluate(() => window.__csp),
      consoleErrors: errors,
      text: text.slice(0, 200),
    });
    await page.screenshot({ path: `${SHOTS}checkout-expired-${width}-${scheme}.png`, fullPage: true });
    await ctx.close();
  }
}
const ctx = await browser.newContext();
const page = await ctx.newPage();
const robots = {};
for (const p of ["/checkout/00000000-0000-0000-0000-000000000000", `/r/${SID}`]) {
  await page.goto(BASE + p, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  robots[p.replace(SID, "<SID>")] = await page.evaluate(() => [...document.querySelectorAll('meta[name="robots"]')].map((m) => `${m.parentElement.tagName}:${m.content}`));
}
console.log(JSON.stringify({ res, robots }, null, 1));
writeFileSync(out, JSON.stringify({ res, robots }, null, 1));
await browser.close();
