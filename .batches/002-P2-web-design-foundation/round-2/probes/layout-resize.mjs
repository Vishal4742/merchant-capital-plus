// Tester probe, round 2:
// 1. quiet vs primary action alignment in the two cards, at 375 and 1440 (box left, text left, height)
// 2. reduced motion: one frame on load and one per resize (canvas bitmap follows the new size)
// 3. no WebGL: the 2D fallback redraws at the new size on resize
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const out = {};
const init = () => {
  window.__draws = 0;
  for (const P of [window.WebGL2RenderingContext].filter(Boolean)) {
    const d = P.prototype.drawArrays;
    P.prototype.drawArrays = function (...a) { window.__draws++; return d.apply(this, a); };
  }
};
async function open(browser, opts) {
  const ctx = await browser.newContext(opts);
  await ctx.route("https://ethereum-rpc.publicnode.com/**", (r) => r.abort("connectionrefused"));
  await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3100/");
  await page.getByRole("button", { name: "Hold to sign again" }).waitFor();
  await page.waitForTimeout(2500);
  return { ctx, page };
}
const canvasState = (page) => page.evaluate(() => { const c = document.querySelector("canvas"); return { bitmapW: c.width, bitmapH: c.height, cssW: c.clientWidth, cssH: c.clientHeight, draws: window.__draws }; });

let browser = await chromium.launch();
for (const width of [375, 1440]) {
  const { ctx, page } = await open(browser, { viewport: { width, height: 900 } });
  out[`align_${width}`] = await page.evaluate(() => {
    const textLeft = (el) => { const r = document.createRange(); const n = [...el.querySelectorAll("*"), el].flatMap((e) => [...e.childNodes]).find((x) => x.nodeType === 3 && x.textContent.trim()); r.selectNodeContents(n); return Math.round(r.getClientRects()[0].left); };
    return [...document.querySelectorAll("main section.grid")].map((card) => {
      const h2 = card.querySelector("h2"), b = card.querySelector("button"), br = b.getBoundingClientRect();
      return { card: h2.textContent, cardTextLeft: textLeft(h2), buttonBoxLeft: Math.round(br.left), buttonTextLeft: textLeft(b), buttonH: Math.round(br.height), buttonW: Math.round(br.width), padding: getComputedStyle(b).padding };
    });
  });
  await ctx.close();
}
// reduced motion: frames on load and per resize
{
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const a = await canvasState(page);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(800);
  const b = await canvasState(page);
  await page.waitForTimeout(1000);
  const c = await canvasState(page);
  out.reduced_resize = { onLoad: a, afterResizeTo1000: b, oneSecondLater: c };
  await ctx.close();
}
await browser.close();
// no WebGL: 2D fallback redraws on resize
browser = await chromium.launch({ args: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"] });
{
  const { ctx, page } = await open(browser, { viewport: { width: 1440, height: 900 } });
  const a = await canvasState(page);
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(600);
  out.fallback_resize = { onLoad: a, afterResizeTo800: await canvasState(page) };
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 1));
