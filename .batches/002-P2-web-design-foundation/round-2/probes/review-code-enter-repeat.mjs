// Reviewer probe: a keyboard user holds Enter on "Hold to sign again" for 2 s (the label says "hold").
// Counts how many times the button confirms. Key auto-repeat is simulated at about 30 Hz after 500 ms.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route((u) => !u.host.startsWith("localhost"), (r) => r.abort());
const page = await ctx.newPage();
await page.goto("http://localhost:3100/");
const btn = page.getByRole("button", { name: "Hold to sign again" });
await btn.waitFor();
await page.waitForTimeout(500);
await btn.evaluate((b) => {
  window.__labels = []; window.__clicks = 0;
  b.addEventListener("click", () => window.__clicks++);
  new MutationObserver(() => { if (window.__labels.at(-1) !== b.textContent) window.__labels.push(b.textContent); })
    .observe(b, { subtree: true, childList: true, characterData: true });
});
await btn.focus();
const t0 = Date.now();
await page.keyboard.down("Enter");
await page.waitForTimeout(500);
while (Date.now() - t0 < 2000) { await page.keyboard.down("Enter"); await page.waitForTimeout(33); }
await page.keyboard.up("Enter");
await page.waitForTimeout(600);
const r = await page.evaluate(() => ({ clicks: window.__clicks, labels: window.__labels }));
console.log(JSON.stringify({ heldMs: 2000, clicks: r.clicks, confirms: r.labels.filter((l) => l === "Signed").length, labels: r.labels }));
await browser.close();
