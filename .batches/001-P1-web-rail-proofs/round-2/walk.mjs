// Tester walkthrough for batch 001 round 2.
// Usage: node walk.mjs <happy|bootfail|badhash|fail> <width> <shotsDir> <netlogPath>
// Never prints the guest key: only match counts.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const [mode, widthArg, shots, netlog] = process.argv.slice(2);
const width = Number(widthArg);
const URL_ = process.env.APP_URL ?? "http://localhost:3100/";
const NYM_WAIT = 300_000;
const BOOT = "https://ethereum-rpc.publicnode.com/**";
const hostOf = (u) => { try { return new URL(u).host || u.slice(0, 30); } catch { return u.slice(0, 30); } };
const t0 = Date.now();
const log = (...a) => console.log(`[${mode}-${width} +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch({ args: [`--log-net-log=${netlog}`, "--net-log-capture-mode=Default"] });
const context = await browser.newContext({ viewport: { width, height: 900 } });
const requests = [];
const sockets = [];
const consoleLines = [];
context.on("request", (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? "" }));
const page = await context.newPage();
page.on("websocket", (ws) => sockets.push(ws.url()));
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
page.on("console", (m) => consoleLines.push(`${ts()} ${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`${ts()} pageerror: ${e.message}`));

const section = (title) => page.locator("section", { hasText: title });
const chain = section("Private chain read");
const sign = section("Guest wallet signature");
const status = (s) => s.locator('[role="status"]');
const counter = (s) => s.locator('p > span[aria-hidden="true"]');
const settled = async (s, timeout = NYM_WAIT) => {
  await page.waitForFunction((el) => /^(OK|Failed)/.test(el.textContent ?? ""), await status(s).elementHandle(), { timeout, polling: 250 });
  return (await status(s).textContent()).trim();
};
const overflow = () => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
const iframes = () => page.evaluate(() => document.querySelectorAll("iframe").length);
const shot = async (name) => {
  const p = `${shots}/tester-${width}-${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  log("shot", p);
};
// Lines the status paragraph renders as, and whether it leaks a URL or request body.
const statusShape = (s) => s.locator("p").evaluate((p) => {
  const lh = parseFloat(getComputedStyle(p).lineHeight);
  return { text: p.textContent, renderedLines: Math.round(p.getBoundingClientRect().height / lh), pWidth: Math.round(p.getBoundingClientRect().width), pScrollW: p.scrollWidth };
});
const focusIsOn = (label) => page.evaluate((l) => {
  const a = document.activeElement;
  return { tag: a?.tagName, text: a?.tagName === "BUTTON" ? a.textContent : "(not a button)", onButton: a?.tagName === "BUTTON" && a.textContent === l, disabled: a?.disabled ?? null };
}, label);

/** Keyboard retry: focus the button, press Enter, then sample focus, disabled state and the live counter. */
async function keyboardRetry(s, label, key) {
  const btn = s.getByRole("button", { name: label });
  await btn.focus();
  const r0 = {};
  const before = requests.length;
  const clickedAt = Date.now();
  r0.focusBeforeEnter = await focusIsOn(label);
  await page.keyboard.press("Enter");
  const r = { ...r0 };
  await page.waitForTimeout(150);
  r.runningText = (await status(s).textContent()).trim();
  r.disabledWhileRunning = await btn.isDisabled();
  r.focusAt150ms = await focusIsOn(label);
  r.counterAt150ms = (await counter(s).count()) ? (await counter(s).textContent()).trim() : null;
  await page.waitForTimeout(3200);
  const stillRunning = !/^(OK|Failed)/.test((await status(s).textContent()).trim());
  r.focusAt3s = await focusIsOn(label);
  r.counterAt3s = (await counter(s).count()) ? (await counter(s).textContent()).trim() : null;
  r.stillRunningAt3s = stillRunning;
  if (stillRunning) await shot(`${key}-running`);
  try { r.result = await settled(s); } catch (e) { r.result = `TIMEOUT: ${e.message.split("\n")[0]}`; }
  r.seconds = (Date.now() - clickedAt) / 1000;
  r.settledAt = ts();
  r.focusAfterSettle = await focusIsOn(label);
  r.counterAfterSettle = await counter(s).count();
  r.requestsDuring = requests.slice(before).map((q) => `${q.method} ${hostOf(q.url)}`);
  // Can the user press Enter again without re-tabbing? (focus kept through the disabled phase)
  return r;
}

let guestKey = null;
const report = { mode, width };
try {
  if (mode === "happy") {
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2300);
    report.loadRunningText = (await status(chain).textContent()).trim();
    report.loadCounter = (await counter(chain).count()) ? (await counter(chain).textContent()).trim() : null;
    report.loadButtonDisabled = await chain.getByRole("button", { name: "Read block again" }).isDisabled();
    log("chain at load:", report.loadRunningText, report.loadCounter);
    await shot("running");
    report.sign1 = await settled(sign, 15_000);
    report.chain1 = await settled(chain);
    report.chain1Shape = await statusShape(chain);
    log("chain:", report.chain1);
    if (report.chain1.startsWith("Failed")) {
      // A failure after the worker booted: does Read block again recover without a reload?
      await shot("first-read-failed");
      report.retryAfterFirstFail = await keyboardRetry(chain, "Read block again", "first-read-failed-retry");
      log("retry after first failure:", JSON.stringify(report.retryAfterFirstFail));
    }
    report.overflow = await overflow();
    await shot("both-ok");
    report.retry = await keyboardRetry(chain, "Read block again", "read-again");
    log("retry:", JSON.stringify(report.retry));
    report.signRetry = await keyboardRetry(sign, "Sign again", "sign-again");
    guestKey = await page.evaluate(() => localStorage.getItem("mcplus.guestKey"));
    report.keyShapeOk = /^0x[0-9a-fA-F]{64}$/.test(guestKey ?? "");
    await page.reload({ waitUntil: "domcontentloaded" });
    report.sign2 = await settled(sign, 15_000);
    const addr = (t) => t.match(/0x[0-9A-Fa-f]{4}…[0-9A-Fa-f]{4}/)?.[0];
    report.sameAddressAfterReload = !!addr(report.sign1) && addr(report.sign1) === addr(report.sign2);
    report.keyUnchangedAfterReload = guestKey === (await page.evaluate(() => localStorage.getItem("mcplus.guestKey")));
    if (width === 1440) {
      report.chain2 = await settled(chain);
      await page.emulateMedia({ colorScheme: "dark" });
      await shot("both-ok-dark");
    }
  } else if (mode === "bootfail") {
    // Block the mainnet bootstrap so the Nym boot fails, then unblock and retry by keyboard, no reload.
    await context.route(BOOT, (r) => r.abort("connectionrefused"));
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    report.chainFail = await settled(chain);
    report.failShape = await statusShape(chain);
    report.overflowFailed = await overflow();
    report.iframesAfterFail = await iframes();
    log("failed:", JSON.stringify(report.failShape), JSON.stringify(report.overflowFailed));
    await shot("bootfail");
    await context.unroute(BOOT);
    report.retry = await keyboardRetry(chain, "Read block again", "bootfail-retry");
    report.iframesAfterRetry = await iframes();
    if (!report.retry.result.startsWith("OK")) {
      await shot("bootfail-retry-failed");
      report.retry2 = await keyboardRetry(chain, "Read block again", "bootfail-retry2");
      log("retry2:", JSON.stringify(report.retry2));
    }
    report.overflowAfterRetry = await overflow();
    log("retry:", JSON.stringify(report.retry));
    await shot("bootfail-recovered");
  } else if (mode === "badhash") {
    // The bootstrap RPC lies about workerHash(): the boot must refuse. Then stop lying and retry.
    let lie = true;
    await context.route(BOOT, async (route) => {
      const body = route.request().postData() ?? "";
      const resp = await route.fetch();
      if (!lie || !body.includes("0x3898587d")) return route.fulfill({ response: resp });
      const json = await resp.json();
      const forged = (j) => ({ ...j, result: `0x${"ab".repeat(32)}` });
      report.hashCallsForged = (report.hashCallsForged ?? 0) + 1;
      return route.fulfill({ response: resp, json: Array.isArray(json) ? json.map(forged) : forged(json) });
    });
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    report.chainFail = await settled(chain);
    report.failShape = await statusShape(chain);
    report.iframesAfterFail = await iframes();
    report.bundleFetchesWhileLying = requests.filter((q) => /jsdelivr|unpkg|githubusercontent/.test(q.url)).length;
    log("refused:", report.chainFail);
    await shot("badhash-refused");
    lie = false;
    report.retry = await keyboardRetry(chain, "Read block again", "badhash-retry");
    log("retry:", JSON.stringify(report.retry));
    await shot("badhash-recovered");
  } else if (mode === "fail") {
    // Corrupt saved key (top frame only), and jsdelivr blocked so the bundle must come from a fallback.
    await context.addInitScript(() => { if (window.top === window) { try { localStorage.setItem("mcplus.guestKey", "not-a-key"); } catch {} } });
    await context.route("https://cdn.jsdelivr.net/**", (r) => r.abort("blockedbyclient"));
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    report.signFail = await settled(sign, 15_000);
    report.signFailShape = await statusShape(sign);
    report.corruptKept = (await page.evaluate(() => localStorage.getItem("mcplus.guestKey"))) === "not-a-key";
    report.chain = await settled(chain);
    report.overflow = await overflow();
    await shot("corrupt-key-jsdelivr-blocked");
  }
} catch (e) {
  report.error = e.message.split("\n")[0];
  log("ERROR", report.error);
  await shot("error").catch(() => {});
}

const byHost = {};
for (const r of requests) {
  const k = `${r.method} ${hostOf(r.url)}`;
  byHost[k] = (byHost[k] ?? 0) + 1;
}
report.requestsByHost = byHost;
report.ankrHits = requests.filter((r) => /ankr/i.test(r.url)).length;
// What each plain bootstrap POST asks for: JSON-RPC method and the 4-byte selector only.
report.bootstrapCalls = requests.filter((r) => r.method === "POST" && r.url.includes("publicnode")).map((r) => {
  try {
    const calls = [JSON.parse(r.body)].flat();
    return calls.map((c) => `${c.method} ${c.params?.[0]?.to ?? ""} ${String(c.params?.[0]?.data ?? c.params?.[0]?.input ?? "").slice(0, 10)}`).join(" | ");
  } catch { return "unparsed"; }
});
report.websockets = sockets.map(hostOf);
if (guestKey) {
  const bare = guestKey.toLowerCase().slice(2);
  report.keyInRequests = requests.filter((r) => (r.url + r.body).toLowerCase().includes(bare)).length;
  report.keyInConsole = consoleLines.filter((l) => l.toLowerCase().includes(bare)).length;
  report.keyInPageHtml = (await page.content()).toLowerCase().includes(bare);
}
report.console = consoleLines.map((l) => (guestKey ? l.split(guestKey.slice(2)).join("<redacted>") : l).slice(0, 200));
await browser.close();
writeFileSync(`${netlog}.report.json`, JSON.stringify(report, null, 2));
log("REPORT", JSON.stringify(report, null, 2));
