// Tester probe, round 2: on the live page, is "busy" (Signing + 3 pulsing dots) on screen during a pointer hold?
// A requestAnimationFrame loop samples the label every frame (rAF runs right before a paint), and a
// MutationObserver records every DOM state. Also: a right-button hold on the live page must not confirm.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const shots = process.argv[2];
const browser = await chromium.launch();
const out = {};
for (const throttle of [1, 6]) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route("https://ethereum-rpc.publicnode.com/**", (r) => r.abort("connectionrefused"));
  const page = await ctx.newPage();
  await page.goto("http://localhost:3100/");
  const btn = page.getByRole("button", { name: "Hold to sign again" });
  await btn.waitFor();
  await page.waitForFunction(() => /signed and verified/.test(document.body.textContent), null, { timeout: 15000 });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes("Hold to sign"));
    window.__dom = []; window.__frames = [];
    new MutationObserver(() => { const s = `${b.textContent}|dots=${b.querySelectorAll("i").length}`; if (window.__dom.at(-1) !== s) window.__dom.push(s); })
      .observe(b, { subtree: true, childList: true, characterData: true });
    const tick = () => { const s = b.textContent; if (window.__frames.at(-1) !== s) window.__frames.push(s); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  if (throttle !== 1) await (await ctx.newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const box = await btn.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ domStates: window.__dom, paintedFrames: window.__frames }));
  r.busyPainted = r.paintedFrames.includes("Signing");
  out[`pointerHold_cpu_x${throttle}`] = r;
  if (throttle === 1) {
    // right-button hold must not confirm
    await page.evaluate(() => { window.__dom = []; });
    await page.mouse.down({ button: "right" });
    await page.waitForTimeout(1200);
    await page.mouse.up({ button: "right" });
    await page.waitForTimeout(600);
    out.rightButtonHold_domStates = await page.evaluate(() => window.__dom);
    // a still of the busy state for the record: slow the sign by blocking the microtask path is not possible here,
    // so take a CPU-throttled capture instead
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await page.mouse.down();
    await page.waitForTimeout(1050);
    await page.mouse.up();
    await page.screenshot({ path: `${shots}/tester-1440-hold-done-throttled.png`, clip: { x: box.x - 20, y: box.y - 120, width: box.width + 60, height: box.height + 140 } });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  }
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await browser.close();
