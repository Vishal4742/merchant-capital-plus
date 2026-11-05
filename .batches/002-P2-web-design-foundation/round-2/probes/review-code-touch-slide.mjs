// Reviewer probe: touch press on the hold button, slide the finger off it, keep it down 1.1 s. Does it still confirm?
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, hasTouch: true, isMobile: true });
await ctx.route((u) => !u.host.startsWith("localhost"), (r) => r.abort());
const page = await ctx.newPage();
await page.goto("http://localhost:3100/");
const btn = page.getByRole("button", { name: "Hold to sign again" });
await btn.waitFor();
await btn.evaluate((b) => b.scrollIntoView({ block: "center" })); await page.waitForTimeout(500);
const box = await btn.boundingBox();
await page.evaluate(() => {
  window.__labels = [];
  const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Hold to sign"));
  new MutationObserver(() => window.__labels.push(b.textContent)).observe(b, { subtree: true, childList: true, characterData: true });
  window.__leaves = 0; window.__ev = [];
  for (const t of ["pointerdown","pointerup","pointercancel","pointerleave","lostpointercapture","gotpointercapture"]) b.addEventListener(t, (e) => window.__ev.push(t + "@" + Math.round(performance.now())));
  b.addEventListener("pointerleave", () => window.__leaves++);
});
const cdp = await ctx.newCDPSession(page);
const at = (x, y) => [{ x, y }];
console.log("box", JSON.stringify(box), await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.outerHTML.slice(0, 60), [box.x + box.width / 2, box.y + box.height / 2]));
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(cx, cy) });
await page.waitForTimeout(100);
for (let i = 1; i <= (process.argv[2] === 'still' ? 0 : 5); i++) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(cx, cy + i * 40) });
  await page.waitForTimeout(20);
}
const MOVE = process.argv[2] !== 'still';
const leavesWhileDown = await page.evaluate(() => window.__leaves);
await page.waitForTimeout(1000);
const labelsWhileOffButton = await page.evaluate(() => window.__labels);
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
const ev = await page.evaluate(() => window.__ev);
console.log(process.argv[2] ?? 'slide', JSON.stringify({ ev, fingerMovedTo: `${cy + 200 - (box.y + box.height)} px below the button`, leavesWhileDown, labelsWhileOffButton }));
await browser.close();
