// Reviewer probe: runs the real components/HoldButton.tsx with React 19 dev builds in headless Chromium.
// A: StrictMode + keyboard confirm (does it return to idle?)  B: same without StrictMode (control)
// C: a release that lands after the hold timer fires but before React renders (state machine race).
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
const page = await browser.newPage();
await page.setContent("<div id=a></div><div id=b></div><div id=c></div>");
const out = await page.evaluate(async (mods) => {
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
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const label = (id) => document.querySelector(`#${id} button`).textContent;
  const result = {};

  for (const [id, strict] of [["a", true], ["b", false]]) {
    const el = h(HoldButton, { label: "Hold", busyLabel: "Busy", doneLabel: "Done", onConfirm: () => Promise.resolve() });
    createRoot(document.getElementById(id)).render(strict ? h(StrictMode, null, el) : el);
    await sleep(50);
    document.querySelector(`#${id} button`).click(); // detail 0, like a keyboard press
    await sleep(1000); // DONE_MS is 450
    result[strict ? "strictKeyboardAfter1s" : "plainKeyboardAfter1s"] = label(id);
  }

  let calls = 0;
  const fire = (type) => document.querySelector("#c button").dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, button: 0 }));
  const onConfirm = () => {
    calls++;
    if (calls === 1) fire("pointerup"); // the release lands before React has rendered "busy"
    return new Promise((r) => setTimeout(r, 4000)); // a slow, network-bound confirm (a payment)
  };
  createRoot(document.getElementById("c")).render(h(HoldButton, { label: "Hold", busyLabel: "Busy", doneLabel: "Done", onConfirm }));
  await sleep(50);
  fire("pointerdown");
  await sleep(1000);
  result.raceLabelWhileFirstConfirmInFlight = label("c");
  fire("pointerdown");
  await sleep(1000);
  fire("pointerup");
  result.raceConfirmCallsWithinOneHoldCycle = calls;
  return result;
}, mods);
console.log(JSON.stringify(out, null, 2));
await browser.close();
