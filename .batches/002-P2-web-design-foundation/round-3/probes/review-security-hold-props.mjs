// reviewer-security round 3: HoldButton cases the tester did not cover, with TRUSTED input (Playwright + CDP).
// Real components/HoldButton.tsx on React 19 dev builds (same loader as the tester's hold-state-trusted.mjs).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WEB = "/Users/vg890/ethglobal/apps/web";
const ts = require(`${WEB}/node_modules/typescript`);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const nm = (p) => readFileSync(`${WEB}/node_modules/${p}`, "utf8");
const hold = ts.transpileModule(readFileSync(`${WEB}/components/HoldButton.tsx`, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const mods = {
  react: nm("react/cjs/react.development.js"),
  "react/jsx-runtime": nm("react/cjs/react-jsx-runtime.development.js"),
  "react-dom": nm("react-dom/cjs/react-dom.development.js"),
  "react-dom/client": nm("react-dom/cjs/react-dom-client.development.js"),
  scheduler: nm("scheduler/cjs/scheduler.development.js"),
  hold,
};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 800, height: 600 }, hasTouch: true });
const page = await ctx.newPage();
await page.setContent("<style>button{display:block;margin:20px;width:240px;height:48px} label{display:block;padding:20px;background:#eee}</style><div id=root></div>");
await page.evaluate((mods) => {
  window.process = { env: { NODE_ENV: "development" } };
  const cache = {};
  const req = (name) => {
    if (cache[name]) return cache[name].exports;
    const module = (cache[name] = { exports: {} });
    new Function("module", "exports", "require", "process", mods[name])(module, module.exports, req, window.process);
    return module.exports;
  };
  const { createElement: h, StrictMode } = req("react");
  const { createRoot } = req("react-dom/client");
  const { HoldButton } = req("hold");
  const root = createRoot(document.getElementById("root"));
  let opts = {};
  const mk = (tag) => () => { window.__calls++; window.__who.push(tag); return Promise.resolve(); };
  const confirms = { A: mk("A"), B: mk("B") };
  window.__render = (o) => {
    opts = { ...opts, ...o };
    if (opts.hidden) return root.render(null);
    const btn = h(HoldButton, { key: opts.key ?? 0, label: opts.text ?? "Hold to pay 25.00", busyLabel: "Busy", doneLabel: "Done", onConfirm: confirms[opts.which ?? "A"] });
    const el = opts.label ? h("label", null, h("span", { id: "lbl" }, "Pay text in a label "), btn) : btn;
    root.render(h(StrictMode, null, el));
  };
  window.__fresh = (o) => { window.__calls = 0; window.__who = []; window.__clicks = []; window.__render({ hidden: false, label: false, key: Math.random(), confirmMs: 0, ...o }); };
  document.addEventListener("click", (e) => { if (e.target.closest("button")) window.__clicks.push({ detail: e.detail, trusted: e.isTrusted }); }, true);
}, mods);

const wait = (ms) => page.waitForTimeout(ms);
const calls = () => page.evaluate(() => window.__calls);
const label = () => page.locator("#root button").textContent().catch(() => null);
const fresh = async (o = {}) => { await page.evaluate((o) => window.__fresh(o), o); await wait(80); };
const box = async () => page.locator("#root button").boundingBox();
const center = async () => { const b = await box(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const out = {};
await fresh({ which: "A", text: "Hold to pay 25.00" });
let [x, y] = await center();
await page.mouse.move(x, y); await page.mouse.down(); await wait(400);
await page.evaluate(() => window.__render({ which: "B", text: "Hold to pay 30.00" })); await wait(50);
const labelMidHold = await label();
await wait(700); await page.mouse.up(); await wait(100);
out.propsChangeMidHold = { labelMidHold, calls: await calls(), whichRan: await page.evaluate(() => window.__who) };
console.log(JSON.stringify(out));
await browser.close();
