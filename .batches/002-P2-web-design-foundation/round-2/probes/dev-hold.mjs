// Tester probe, round 2: under `next dev` (StrictMode on by default in the App Router), the hold button
// must go back to idle after every confirm, by keyboard and by pointer, and Enter held must confirm once.
// Usage: node dev-hold.mjs http://localhost:3104/
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const url = process.argv[2];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.route("https://ethereum-rpc.publicnode.com/**", (r) => r.abort("connectionrefused"));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
await page.goto(url, { timeout: 120000 });
const btn = page.getByRole("button", { name: /sign/i }).last();
await page.waitForFunction(() => /signed and verified/.test(document.body.textContent), null, { timeout: 120000 });
await page.waitForTimeout(800);
const strict = await page.evaluate(() => {
  // React marks StrictMode fibers with mode bit 0b1000 (StrictLegacyMode) in dev builds
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Hold to sign"));
  const k = Object.keys(b).find((x) => x.startsWith("__reactFiber$"));
  return k ? (b[k].mode & 0b1000) !== 0 : "no fiber key";
});
await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Hold to sign"));
  window.__labels = [];
  new MutationObserver(() => { if (window.__labels.at(-1) !== b.textContent) window.__labels.push(b.textContent); }).observe(b, { subtree: true, childList: true, characterData: true });
});
const label = () => btn.textContent();
const aria = () => btn.getAttribute("aria-disabled");
const out = { strictModeOnFiber: strict, keyboard: [], pointer: [] };
for (let i = 0; i < 3; i++) {
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1000);
  out.keyboard.push({ label: await label(), ariaDisabled: await aria() });
}
const box = await btn.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 3; i++) {
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  await page.waitForTimeout(1000);
  out.pointer.push({ label: await label(), ariaDisabled: await aria() });
}
// confirms in the 6 presses above (3 keyboard + 3 pointer)
out.signedDuringLoop = await page.evaluate(() => window.__labels.filter((l) => l === "Signed").length);
// Enter held 2 s with auto-repeat
await page.evaluate(() => { window.__labels = []; });
await btn.focus();
const t0 = Date.now();
await page.keyboard.down("Enter");
await page.waitForTimeout(500);
while (Date.now() - t0 < 2000) { await page.keyboard.down("Enter"); await page.waitForTimeout(33); }
await page.keyboard.up("Enter");
await page.waitForTimeout(800);
const held = await page.evaluate(() => window.__labels);
out.enterHeld2s = { confirms: held.filter((l) => l === "Signed").length, labels: held, endLabel: await label() };
out.pageErrors = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
