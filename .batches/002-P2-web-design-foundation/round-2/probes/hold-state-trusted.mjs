// Tester probe, round 2: reviewer-code's hold-state harness (real components/HoldButton.tsx on React 19 dev
// builds) driven with TRUSTED input (Playwright mouse/keyboard), because round 2 ignores untrusted events,
// so the round-1 probe's element.click()/dispatchEvent no longer reach confirm().
// A: StrictMode + Enter, twice (does it return to idle each time?)  B: same without StrictMode
// C: late release while a slow confirm is in flight  D: release sweep around 900 ms  E: right button  F: StrictMode pointer hold
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
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
await page.setContent("<style>button{display:block;margin:20px;width:240px;height:48px}</style><div id=root></div>");
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
  let root;
  // mount(strict, confirmMs): fresh button; window.__calls counts onConfirm calls
  window.__mount = (strict, confirmMs) => {
    root?.unmount();
    document.getElementById("root").innerHTML = "";
    root = createRoot(document.getElementById("root"));
    window.__calls = 0;
    const onConfirm = () => { window.__calls++; return new Promise((r) => setTimeout(r, confirmMs)); };
    const el = h(HoldButton, { label: "Hold", busyLabel: "Busy", doneLabel: "Done", onConfirm });
    root.render(strict ? h(StrictMode, null, el) : el);
  };
}, mods);

const label = () => page.locator("#root button").textContent();
const calls = () => page.evaluate(() => window.__calls);
const mount = async (strict, confirmMs) => { await page.evaluate(([s, m]) => window.__mount(s, m), [strict, confirmMs]); await page.waitForTimeout(80); };
const center = async () => { const b = await page.locator("#root button").boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const out = {};

for (const strict of [true, false]) {
  await mount(strict, 0);
  const r = [];
  for (let i = 0; i < 2; i++) {
    await page.locator("#root button").focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000); // DONE_MS is 450
    r.push(await label());
  }
  out[strict ? "A_strict_enter_x2_labelsAfter1s" : "B_plain_enter_x2_labelsAfter1s"] = { labels: r, calls: await calls() };
}

// C: late release while the first confirm (4 s) is in flight, then a second full hold
await mount(true, 4000);
let [x, y] = await center();
await page.mouse.move(x, y);
await page.mouse.down();
await page.waitForTimeout(1000);
await page.mouse.up(); // late release
await page.waitForTimeout(50);
const labelAfterLateRelease = await label();
await page.mouse.down();
await page.waitForTimeout(1000);
await page.mouse.up();
out.C_lateRelease = { labelAfterLateRelease, labelAfterSecondHold: await label(), callsWithinFlight: await calls() };

// D: release sweep around HOLD_MS; each run then tries a second hold while the 2 s confirm is in flight
out.D_sweep = [];
for (const ms of [860, 880, 890, 895, 900, 905, 910, 920, 950]) {
  await mount(true, 2000);
  [x, y] = await center();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(30);
  const l1 = await label();
  const c1 = await calls();
  await page.mouse.down();
  await page.waitForTimeout(400); // second press while the first confirm is in flight (busy) or after a cancel
  await page.mouse.up();
  const c2 = await calls();
  out.D_sweep.push({ releaseAtMs: ms, labelAfterRelease: l1, callsAfterRelease: c1, callsAfterSecondPress: c2, consistent: (c1 === 0 && l1 === "Hold") || (c1 === 1 && l1 === "Busy") });
}

// E: right-button hold 1.1 s
await mount(true, 0);
[x, y] = await center();
await page.mouse.move(x, y);
await page.mouse.down({ button: "right" });
await page.waitForTimeout(1100);
await page.mouse.up({ button: "right" });
await page.waitForTimeout(100);
out.E_rightButtonHold = { calls: await calls(), label: await label() };

// F: StrictMode, pointer hold twice: back to idle each time
await mount(true, 0);
[x, y] = await center();
await page.mouse.move(x, y);
const f = [];
for (let i = 0; i < 2; i++) {
  await page.mouse.down();
  await page.waitForTimeout(1000);
  await page.mouse.up();
  await page.waitForTimeout(1000);
  f.push(await label());
}
out.F_strict_pointer_x2 = { labels: f, calls: await calls() };

console.log(JSON.stringify(out, null, 1));
await browser.close();
