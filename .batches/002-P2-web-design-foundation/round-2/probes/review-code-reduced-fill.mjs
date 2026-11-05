// Reviewer probe: the hold fill's scaleX 150 ms into a held press, with and without reduced motion.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const browser = await chromium.launch();
for (const reducedMotion of ["no-preference", "reduce"]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion });
  await ctx.route((u) => !u.host.startsWith("localhost"), (r) => r.abort());
  const page = await ctx.newPage();
  await page.goto("http://localhost:3100/");
  const btn = page.getByRole("button", { name: "Hold to sign again" });
  await btn.waitFor();
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(150);
  const t = await btn.evaluate((b) => getComputedStyle(b.querySelector("span")).transform);
  await page.mouse.up();
  console.log(reducedMotion, "fill transform at 150 ms:", t);
  await ctx.close();
}
await browser.close();
