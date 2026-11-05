// reviewer-code probe, round 3: the real components/HoldButton.tsx inside React 19's <Activity>. With
// cacheComponents: true, Next 16 hides the previous route in <Activity mode="hidden">, which runs effect cleanups
// (here: clearTimeout of the done -> idle timer) and keeps state. Question: hidden during "done", shown again later:
// does the button get back to idle?  Run: node review-code-activity-hold.mjs   (no server; no .env read)
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const WEB = "/Users/vg890/ethglobal/apps/web";
const ts = require(`${WEB}/node_modules/typescript`);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const nm = (p) => readFileSync(`${WEB}/node_modules/${p}`, "utf8");
const mods = {
  react: nm("react/cjs/react.development.js"),
  "react/jsx-runtime": nm("react/cjs/react-jsx-runtime.development.js"),
  "react-dom": nm("react-dom/cjs/react-dom.development.js"),
  "react-dom/client": nm("react-dom/cjs/react-dom-client.development.js"),
  scheduler: nm("scheduler/cjs/scheduler.development.js"),
  hold: ts.transpileModule(readFileSync(`${WEB}/components/HoldButton.tsx`, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText,
};
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent("<div id=root></div>");
await page.evaluate((mods) => {
  window.process = { env: { NODE_ENV: "development" } };
  const cache = {};
  const req = (name) => {
    if (cache[name]) return cache[name].exports;
    const module = (cache[name] = { exports: {} });
    new Function("module", "exports", "require", "process", mods[name])(module, module.exports, req, window.process);
    return module.exports;
  };
  const { createElement: h, Activity } = req("react");
  const { createRoot } = req("react-dom/client");
  const { HoldButton } = req("hold");
  const root = createRoot(document.getElementById("root"));
  window.__calls = 0;
  const onConfirm = () => { window.__calls++; return Promise.resolve(); };
  window.__show = (mode) => root.render(h(Activity, { mode }, h(HoldButton, { label: "Hold", busyLabel: "Busy", doneLabel: "Done", onConfirm })));
}, mods);
const btn = page.locator("#root button");
const snap = async () => ({ label: await btn.textContent(), ariaDisabled: await btn.getAttribute("aria-disabled"), calls: await page.evaluate(() => window.__calls) });
const out = {};
await page.evaluate(() => window.__show("visible"));
await page.waitForTimeout(100);
await btn.focus();
await page.keyboard.press("Enter"); // keyboard confirm -> busy -> done (450 ms timer to idle)
await page.waitForTimeout(50);
out.afterConfirm = await snap();
await page.evaluate(() => window.__show("hidden")); // route hidden while "done"
await page.waitForTimeout(800);
await page.evaluate(() => window.__show("visible"));
await page.waitForTimeout(800);
out.shownAgainAfter800ms = await snap();
await btn.focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(100);
out.afterSecondEnter = await snap();
await browser.close();
console.log(JSON.stringify(out));
