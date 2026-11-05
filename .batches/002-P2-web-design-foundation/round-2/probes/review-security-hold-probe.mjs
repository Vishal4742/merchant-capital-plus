// Security probe for HoldButton (batch 002 round 1). Counts confirms by counting reads of the guest-key
// storage slot (one per sign); never reads or prints the stored value.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const URL_ = "http://localhost:3100/";
const browser = await chromium.launch();
const results = {};

async function fresh() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/publicnode|jsdelivr|nymtech|ankr|whitechain/, (r) => r.abort());
  await context.addInitScript(() => {
    window.__signs = 0;
    window.__clicks = [];
    const get = Storage.prototype.getItem;
    Storage.prototype.getItem = function (k) {
      if (k === "mcplus.guestKey") window.__signs++;
      return get.call(this, k);
    };
    document.addEventListener("click", (e) => window.__clicks.push({ detail: e.detail, trusted: e.isTrusted }), true);
  });
  const page = await context.newPage();
  await page.goto(URL_);
  const btn = page.getByRole("button", { name: /Hold to sign again/ });
  await btn.waitFor();
  await page.waitForTimeout(600); // let the auto-run sign settle
  const base = await page.evaluate(() => window.__signs);
  const signs = async () => (await page.evaluate(() => window.__signs)) - base;
  const clicks = () => page.evaluate(() => window.__clicks.splice(0));
  await clicks();
  return { context, page, btn, signs, clicks };
}

// A. element.click() from a script: detail 0, untrusted
{
  const { context, page, btn, signs, clicks } = await fresh();
  await btn.evaluate((b) => b.click());
  await page.waitForTimeout(100);
  results.scriptClick = { signs: await signs(), clicks: await clicks() };
  await context.close();
}
// B. dispatchEvent(new MouseEvent("click"))
{
  const { context, page, btn, signs, clicks } = await fresh();
  await btn.evaluate((b) => b.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await page.waitForTimeout(100);
  results.dispatchedClick = { signs: await signs(), clicks: await clicks() };
  await context.close();
}
// C. one Enter press (trusted keyboard activation)
{
  const { context, page, btn, signs, clicks } = await fresh();
  await btn.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  results.enterOnce = { signs: await signs(), clicks: await clicks() };
  await context.close();
}
// D. Enter held down with OS auto-repeat (~30/s after the first press) for 2.5 s
{
  const { context, page, btn, signs, clicks } = await fresh();
  await btn.focus();
  const cdp = await context.newCDPSession(page);
  const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" };
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key });
  await page.waitForTimeout(500);
  const end = Date.now() + 2000;
  while (Date.now() < end) {
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", autoRepeat: true, ...key });
    await page.waitForTimeout(33);
  }
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  await page.waitForTimeout(100);
  const c = await clicks();
  results.enterHeld = { signs: await signs(), clicksFired: c.length, sample: c.slice(0, 2) };
  await context.close();
}
// E. a scripted 1 s "hold": synthetic pointer events
{
  const { context, page, btn, signs } = await fresh();
  await btn.evaluate((b) => b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, isPrimary: true })));
  await page.waitForTimeout(1000);
  await btn.evaluate((b) => b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, isPrimary: true })));
  await page.waitForTimeout(100);
  results.syntheticHold = { signs: await signs() };
  await context.close();
}
// F. real mouse held 3 s: one confirm, or does it re-arm after done?
{
  const { context, page, btn, signs } = await fresh();
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(3000);
  await page.mouse.up();
  await page.waitForTimeout(100);
  results.mouseHeld3s = { signs: await signs() };
  await context.close();
}

console.log(JSON.stringify(results, null, 1));
await browser.close();
