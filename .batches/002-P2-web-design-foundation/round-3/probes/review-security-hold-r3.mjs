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
  const onConfirm = () => { window.__calls++; return new Promise((r) => setTimeout(r, opts.confirmMs ?? 0)); };
  window.__render = (o) => {
    opts = { ...opts, ...o };
    if (opts.hidden) return root.render(null);
    const btn = h(HoldButton, { key: opts.key ?? 0, label: "Hold", busyLabel: "Busy", doneLabel: "Done", onConfirm });
    const el = opts.label ? h("label", null, h("span", { id: "lbl" }, "Pay text in a label "), btn) : btn;
    root.render(h(StrictMode, null, el));
  };
  window.__fresh = (o) => { window.__calls = 0; window.__clicks = []; window.__render({ hidden: false, label: false, key: Math.random(), confirmMs: 0, ...o }); };
  document.addEventListener("click", (e) => { if (e.target.closest("button")) window.__clicks.push({ detail: e.detail, trusted: e.isTrusted }); }, true);
}, mods);

const wait = (ms) => page.waitForTimeout(ms);
const calls = () => page.evaluate(() => window.__calls);
const label = () => page.locator("#root button").textContent().catch(() => null);
const fresh = async (o = {}) => { await page.evaluate((o) => window.__fresh(o), o); await wait(80); };
const box = async () => page.locator("#root button").boundingBox();
const center = async () => { const b = await box(); return [b.x + b.width / 2, b.y + b.height / 2]; };
const out = {};
const cdp = await ctx.newCDPSession(page);

// 1. Unmount mid-hold: no confirm after the button is gone
await fresh();
let [x, y] = await center();
await page.mouse.move(x, y); await page.mouse.down(); await wait(400);
await page.evaluate(() => window.__render({ hidden: true })); await wait(1000); await page.mouse.up();
out.unmountMidHold = { calls: await calls() };

// 2. Pointer hold, Enter pressed during the hold, then Enter again while busy
await fresh({ confirmMs: 2000 });
[x, y] = await center();
await page.mouse.move(x, y); await page.mouse.down(); await wait(300);
await page.keyboard.press("Enter"); await wait(900); await page.mouse.up();
await page.keyboard.press("Enter"); await wait(100);
out.enterDuringHold = { calls: await calls(), label: await label() };

// 3. Mouse slides off and back on while held
await fresh();
[x, y] = await center();
await page.mouse.move(x, y); await page.mouse.down(); await wait(300);
await page.mouse.move(x, y + 200, { steps: 3 }); await wait(200);
await page.mouse.move(x, y, { steps: 3 }); await wait(1200); await page.mouse.up(); await wait(100);
out.mouseOffAndBack = { calls: await calls() };

// 4. Held Space (CDP autoRepeat, 2 s)
await fresh();
await page.locator("#root button").focus();
const key = (type, autoRepeat = false) => cdp.send("Input.dispatchKeyEvent", { type, key: " ", code: "Space", windowsVirtualKeyCode: 32, text: type === "keyDown" ? " " : undefined, autoRepeat });
await key("keyDown");
for (let t = 0; t < 2000; t += 33) { await key("keyDown", true); await wait(33); }
await key("keyUp"); await wait(600);
out.spaceHeld2s = { calls: await calls(), clicks: (await page.evaluate(() => window.__clicks)).length };

// 5. Two fingers: A down, B down, A up (cancels), B held 1.5 s
await fresh();
[x, y] = await center();
const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
await touch("touchStart", [{ x, y, id: 1 }]); await wait(200);
await touch("touchStart", [{ x, y, id: 1 }, { x: x + 40, y, id: 2 }]); await wait(200);
await touch("touchEnd", [{ x: x + 40, y, id: 2 }]); await wait(1500);
await touch("touchEnd", []); await wait(100);
out.twoFingersLiftFirst = { calls: await calls() };

// 6. Remount while a confirm is in flight: the lock is per instance
await fresh({ confirmMs: 3000 });
[x, y] = await center();
await page.mouse.move(x, y); await page.mouse.down(); await wait(1000); await page.mouse.up();
const inFlight = await calls();
await page.evaluate(() => window.__render({ key: "remounted" })); await wait(80);
const labelAfterRemount = await label();
await page.mouse.down(); await wait(1000); await page.mouse.up();
out.remountWhileBusy = { callsBefore: inFlight, labelAfterRemount, callsAfterSecondHold: await calls() };

// 7. HoldButton inside a <label>: a quick mouse click on the label text
await fresh({ label: true });
await page.locator("#lbl").click(); await wait(200);
out.quickClickOnWrappingLabel = { calls: await calls(), clicksOnButton: await page.evaluate(() => window.__clicks) };

console.log(JSON.stringify(out));
await browser.close();
