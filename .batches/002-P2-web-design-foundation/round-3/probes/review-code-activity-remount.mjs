// reviewer-code probe, round 3: the real components/DitherScene.tsx inside React 19's <Activity>, hidden and
// shown again on the same canvas. next.config.ts has cacheComponents: true, so Next 16 keeps the last routes in a
// hidden <Activity> (node_modules/next/dist/client/components/layout-router.js:518): effects clean up on hide and
// re-run on show with the same DOM. Also run with forceContextLoss() stripped as the control.
// Run: node review-code-activity-remount.mjs   (no server needed; no .env read)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WEB = "/Users/vg890/ethglobal/apps/web";
const ts = require(`${WEB}/node_modules/typescript`);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const tx = (p, patch = (s) => s) =>
  ts.transpileModule(patch(readFileSync(`${WEB}/${p}`, "utf8")), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
const nm = (p) => readFileSync(`${WEB}/node_modules/${p}`, "utf8");

async function run(label, patch) {
  const mods = {
    react: nm("react/cjs/react.development.js"),
    "react/jsx-runtime": nm("react/cjs/react-jsx-runtime.development.js"),
    "react-dom": nm("react-dom/cjs/react-dom.development.js"),
    "react-dom/client": nm("react-dom/cjs/react-dom-client.development.js"),
    scheduler: nm("scheduler/cjs/scheduler.development.js"),
    "@/lib/dither": tx("lib/dither.ts"),
    scene: tx("components/DitherScene.tsx", patch),
  };
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.route("http://probe.local/**", (route) => {
    const f = new URL(route.request().url()).pathname.slice(1);
    if (f === "") return route.fulfill({ contentType: "text/html", body: "<div id=root></div>" });
    route.fulfill({ contentType: "text/javascript", body: nm(`three/build/${f}`) });
  });
  await page.goto("http://probe.local/");
  await page.evaluate(async (mods) => {
    window.__draws = 0;
    const orig = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function (...a) { window.__draws++; return orig.apply(this, a); };
    const THREE = await import("http://probe.local/three.module.js");
    window.process = { env: { NODE_ENV: "development" } };
    const cache = { three: { exports: Object.assign({ __esModule: true }, THREE) } };
    const req = (name) => {
      if (cache[name]) return cache[name].exports;
      const module = (cache[name] = { exports: {} });
      new Function("module", "exports", "require", "process", mods[name])(module, module.exports, req, window.process);
      return module.exports;
    };
    const { createElement: h, Activity } = req("react");
    const { createRoot } = req("react-dom/client");
    const { DitherScene } = req("scene");
    const root = createRoot(document.getElementById("root"));
    window.__show = (mode) =>
      root.render(h(Activity, { mode }, h("div", { style: { position: "relative", width: "600px", height: "400px", background: "#12131c" } }, h(DitherScene))));
  }, mods);
  const state = () =>
    page.evaluate(() => {
      const c = document.querySelector("canvas");
      const gl = c.getContext("webgl2");
      return { draws: window.__draws, webgl2Lost: gl ? gl.isContextLost() : "no-webgl2", canvasSame: c === window.__c };
    });
  const out = {};
  await page.evaluate(() => window.__show("visible"));
  await page.waitForTimeout(700);
  await page.evaluate(() => (window.__c = document.querySelector("canvas")));
  out.first = await state();
  await page.evaluate(() => window.__show("hidden"));
  await page.waitForTimeout(300);
  out.hidden = await state();
  const before = out.hidden.draws;
  await page.evaluate(() => window.__show("visible"));
  await page.waitForTimeout(700);
  out.shownAgain = await state();
  out.drawsAfterShow = out.shownAgain.draws - before;
  await browser.close();
  console.log(JSON.stringify({ label, ...out }));
}

await run("as-built");
await run("control: forceContextLoss removed", (s) => s.replace("renderer.forceContextLoss();", ""));
