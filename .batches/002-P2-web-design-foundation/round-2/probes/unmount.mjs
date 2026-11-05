// Forces a React unmount of the page (an error boundary takes over) to watch DitherScene's cleanup.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.route("https://ethereum-rpc.publicnode.com/**", (r) => r.abort("connectionrefused"));
await context.addInitScript(() => {
  window.__draws = 0;
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean)) {
    const d = P.prototype.drawArrays;
    P.prototype.drawArrays = function (...a) { window.__draws++; return d.apply(this, a); };
  }
  const add = EventTarget.prototype.addEventListener, rem = EventTarget.prototype.removeEventListener;
  window.__listeners = new Map();
  EventTarget.prototype.addEventListener = function (t, f, o) { if (["pointermove", "pointerleave", "resize"].includes(t)) window.__listeners.set(f, t); return add.call(this, t, f, o); };
  EventTarget.prototype.removeEventListener = function (t, f, o) { window.__listeners.delete(f); return rem.call(this, t, f, o); };
});
const page = await context.newPage();
const lines = [];
page.on("console", (m) => lines.push(`${m.type()}: ${m.text().slice(0, 160)}`));
page.on("pageerror", (e) => lines.push(`pageerror: ${e.message.slice(0, 160)}`));
await page.goto("http://localhost:3100/");
await page.waitForFunction(() => /signed and verified/.test(document.body.textContent), null, { timeout: 15000 });
await page.waitForTimeout(2000);
const before = await page.evaluate(async () => {
  window.__cv = document.querySelector("canvas");
  const a = window.__draws; await new Promise((r) => setTimeout(r, 1000));
  return { drawsPerSec: window.__draws - a, listeners: [...window.__listeners.values()] };
});
const dispatched = await page.evaluate(() => {
  const el = document.querySelector("h1");
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  for (let f = el[key]; f; f = f.return) {
    for (let h = f.memoizedState; h && typeof h === "object" && "next" in h; h = h.next) {
      if (h.memoizedState?.state === "ok" && h.queue?.dispatch) { h.queue.dispatch({ state: "ok", detail: { bad: 1 }, ms: 0 }); return true; }
    }
  }
  return false;
});
await page.waitForTimeout(1500);
const after = await page.evaluate(async () => {
  const a = window.__draws; await new Promise((r) => setTimeout(r, 1000));
  const gl = window.__cv.getContext("webgl2");
  return { canvasInDom: !!document.querySelector("canvas"), oldCanvasConnected: window.__cv.isConnected, drawsPerSec: window.__draws - a, contextLost: gl ? gl.isContextLost() : "no-context", listenersLeft: [...window.__listeners.values()] };
});
console.log(JSON.stringify({ before, dispatched, after, console: lines.filter((l) => !/ERR_CONNECTION_REFUSED|GPU stall|Failed to load/.test(l)).slice(0, 6) }, null, 1));
await browser.close();
