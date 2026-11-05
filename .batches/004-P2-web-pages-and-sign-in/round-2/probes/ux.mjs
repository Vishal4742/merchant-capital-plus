import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const BASE = "http://localhost:3100";
const SHOTS = new URL("../shots/", import.meta.url).pathname;
const KEY = process.env.K;
const NIL = "00000000-0000-0000-0000-000000000000";
const CRYPTO = /\b(sign|gas|wallet|whitechain|chain|WBT)\b/i;
const mk = async () => (await (await fetch(BASE + "/api/v1/sessions", { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify({ amount: "25.00", reference: "T-1042", items: [{ name: "Flat white", qty: 2, price: "10.00" }, { name: "Croissant", qty: 1, price: "5.00" }] }) })).json()).id;
const browser = await chromium.launch();
const out = [];
const hold = async (page) => { const b = page.getByRole("button", { name: /Hold to pay/ }); const bb = await b.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.mouse.down(); await page.waitForTimeout(2600); await page.mouse.up(); await page.waitForTimeout(2500); };
for (const width of [375, 1440]) for (const scheme of ["light", "dark"]) {
  const tag = `ux2-${width}-${scheme}`;
  const run = async (name, fn, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 812 : 900 }, colorScheme: scheme });
    if (opts.future) await ctx.addInitScript(() => { const n = Date.now; Date.now = () => n() + 3600e3; });
    const page = await ctx.newPage();
    const r = { name: `${name}-${tag}` };
    try { await fn(page, r); } catch (e) { r.err = String(e).slice(0, 200); }
    const text = (await page.innerText("body").catch(() => "")).replace(/\s+/g, " ");
    r.text = text.slice(0, 300); r.crypto = CRYPTO.exec(text)?.[0] ?? null;
    r.overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await page.screenshot({ path: `${SHOTS}${name}-${tag}.png`, fullPage: true });
    out.push(r); await ctx.close();
  };
  await run("nf-checkout", (p) => p.goto(`${BASE}/checkout/${NIL}`));
  await run("nf-receipt", (p) => p.goto(`${BASE}/r/${NIL}`));
  await run("ready", async (p, r) => { await p.goto(`${BASE}/checkout/${await mk()}`); await p.waitForTimeout(1500); r.desc = await p.locator("#pay-hint").innerText(); });
  await run("error", async (p, r) => { await p.goto(`${BASE}/checkout/${await mk()}`); await p.waitForTimeout(1500); await hold(p); r.alert = await p.getByRole("alert").allInnerTexts(); });
  await run("confirming", async (p, r) => { await p.route("**/pay", (rt) => rt.abort()); await p.goto(`${BASE}/checkout/${await mk()}`); await p.waitForTimeout(1500); await hold(p); r.status = await p.getByRole("status").allInnerTexts(); r.btn = await p.getByRole("button").allInnerTexts(); const b = p.getByRole("button", { name: "Check again" }); r.h = (await b.boundingBox())?.height; });
  await run("expired", async (p) => { await p.goto(`${BASE}/checkout/${await mk()}`); await p.waitForTimeout(1500); }, { future: true });
  await run("merchant", (p) => p.goto(`${BASE}/merchant`));
  await run("home", async (p, r) => { await p.goto(BASE); await p.waitForTimeout(1500); const l = p.getByText("Private reads and wallet proofs"); r.footer = await l.boundingBox(); r.form = await p.locator("form").evaluateAll((fs) => fs.map((f) => f.method + " " + f.getAttribute("action"))); });
}
console.log(JSON.stringify(out, null, 1)); writeFileSync("ux.json", JSON.stringify(out, null, 1));
await browser.close();
