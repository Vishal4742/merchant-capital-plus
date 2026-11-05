// Tester probe, round 2: real contrast of the hero text over the scene + night wash, from pixels.
// For each hero text element: screenshot the hero with the text made transparent (scene and wash stay),
// three times 700 ms apart (twinkle), take the brightest background pixel under the text's line boxes,
// and compute WCAG contrast of the text colour (with its opacity) over it.
// Usage: node hero-contrast.mjs <width> <light|dark>
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const width = Number(process.argv[2]);
const scheme = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
await ctx.route("https://ethereum-rpc.publicnode.com/**", (r) => r.abort("connectionrefused"));
const page = await ctx.newPage();
await page.goto("http://localhost:3100/");
await page.waitForTimeout(3500); // gather done (1.8 s)
await page.mouse.move(width - 2, 899); // pointer off the scene

const targets = await page.evaluate(() => {
  const hero = document.querySelector("main > section");
  const els = [hero.querySelector("header span.title"), hero.querySelector("header span.data"), hero.querySelector("h1"), hero.querySelector("h1 .emphasis"), hero.querySelector("p")];
  const toRGB = (s) => s.match(/[\d.]+/g).map(Number);
  return els.filter(Boolean).map((el) => {
    let op = 1;
    for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const b of r.getClientRects()) if (b.width > 0) rects.push([Math.floor(b.left), Math.floor(b.top + window.scrollY), Math.ceil(b.width), Math.ceil(b.height)]);
    }
    const cs = getComputedStyle(el);
    return { text: el.textContent.trim().slice(0, 32), visible: el.getClientRects().length > 0, color: toRGB(cs.color).slice(0, 3), opacity: +op.toFixed(2), size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), rects };
  });
});
await page.addStyleTag({ content: "main > section * { color: transparent !important; text-decoration-color: transparent !important; }" });
await page.waitForTimeout(100);
const shots = [];
for (let i = 0; i < 3; i++) { shots.push((await page.screenshot({ clip: { x: 0, y: 0, width, height: 600 } })).toString("base64")); await page.waitForTimeout(700); }

const result = await page.evaluate(async ([shots, targets]) => {
  const imgs = [];
  for (const s of shots) {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext("2d"); x.drawImage(bm, 0, 0);
    imgs.push(x.getImageData(0, 0, bm.width, bm.height));
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const [p, q] = [L(a), L(b)].sort((m, n) => n - m); return +((p + 0.05) / (q + 0.05)).toFixed(2); };
  return targets.map((t) => {
    if (!t.visible || !t.rects.length) return { text: t.text, visible: false };
    let worst = null, worstL = -1, n = 0;
    for (const img of imgs) for (const [x0, y0, w, h] of t.rects) for (let y = y0; y < Math.min(y0 + h, img.height); y++) for (let x = x0; x < Math.min(x0 + w, img.width); x++) {
      const i = 4 * (y * img.width + x); const px = [img.data[i], img.data[i + 1], img.data[i + 2]]; const l = L(px); n++;
      if (l > worstL) { worstL = l; worst = px; }
    }
    const fg = t.color.map((v, k) => v * t.opacity + worst[k] * (1 - t.opacity));
    const large = t.size >= 24 || (t.size >= 18.66 && t.weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(fg, worst);
    return { text: t.text, size: t.size, opacity: t.opacity, pixelsSampled: n, brightestBg: worst, worstRatio: r, need, pass: r >= need };
  });
}, [shots, targets]);
console.log(JSON.stringify({ width, scheme, result }));
await browser.close();
