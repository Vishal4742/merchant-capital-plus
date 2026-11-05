// Tester walkthrough for batch 001 round 1. Usage: node walk.mjs <happy|fail> <width> <shotsDir> <netlogPath>
// Never prints the guest key: only match counts.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const [mode, widthArg, shots, netlog] = process.argv.slice(2);
const width = Number(widthArg);
const URL_ = process.env.APP_URL ?? "http://localhost:3100/";
const NYM_WAIT = 170_000;
const hostOf = (u) => { try { return new URL(u).host || u.slice(0, 30); } catch { return u.slice(0, 30); } };
const t0 = Date.now();
const log = (...a) => console.log(`[${mode}-${width} +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const browser = await chromium.launch({ args: [`--log-net-log=${netlog}`, "--net-log-capture-mode=Default"] });
const context = await browser.newContext({ viewport: { width, height: 900 } });
const requests = [];
const sockets = [];
const consoleLines = [];
context.on("request", (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() ?? "" }));
context.on("requestfailed", (r) => log("requestfailed", r.method(), r.url().slice(0, 120), r.failure()?.errorText));
const page = await context.newPage();
page.on("websocket", (ws) => sockets.push(ws.url()));
page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => consoleLines.push(`pageerror: ${e.message}`));

const card = (title) => page.locator("section", { hasText: title }).locator('[role="status"]');
const chainStatus = card("Private chain read");
const signStatus = card("Guest wallet signature");
const settled = async (loc, timeout = NYM_WAIT) => {
  await page.waitForFunction(
    (el) => /^(OK|Failed)/.test(el.textContent ?? ""),
    await loc.elementHandle(),
    { timeout, polling: 500 },
  );
  return (await loc.textContent()).trim();
};
const overflow = () => page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
const shot = async (name) => {
  const p = `${shots}/tester-${width}-${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  log("shot", p);
};

let guestKey = null;
const report = { mode, width };
try {
  if (mode === "happy") {
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    report.connectingText = (await chainStatus.textContent()).trim();
    log("chain card at load:", report.connectingText);
    await shot("connecting");
    report.sign1 = await settled(signStatus, 15_000);
    log("sign:", report.sign1);
    report.chain1 = await settled(chainStatus);
    log("chain:", report.chain1);
    if (report.chain1.startsWith("Failed")) {
      await shot("dep6-failed");
      const clickedAt = Date.now();
      await page.locator("section", { hasText: "Private chain read" }).getByRole("button", { name: "Run again" }).click();
      report.chain1Retry = await settled(chainStatus);
      report.chain1RetrySeconds = (Date.now() - clickedAt) / 1000;
      log("chain after Run again:", report.chain1Retry);
    }
    report.overflow = await overflow();
    log("overflow", JSON.stringify(report.overflow));
    await shot("both-ok");
    guestKey = await page.evaluate(() => localStorage.getItem("mcplus.guestKey"));
    report.keyShapeOk = /^0x[0-9a-fA-F]{64}$/.test(guestKey ?? "");
    // Persistence across reload.
    await page.reload({ waitUntil: "domcontentloaded" });
    report.sign2 = await settled(signStatus, 15_000);
    log("sign after reload:", report.sign2);
    const addr = (s) => s.match(/0x[0-9A-Fa-f]{4}…[0-9A-Fa-f]{4}/)?.[0];
    report.sameAddressAfterReload = addr(report.sign1) === addr(report.sign2) && !!addr(report.sign1);
    report.keyUnchangedAfterReload = guestKey === (await page.evaluate(() => localStorage.getItem("mcplus.guestKey")));
    if (width === 1440) {
      report.chain2 = await settled(chainStatus);
      log("chain after reload:", report.chain2);
      await page.emulateMedia({ colorScheme: "dark" });
      await shot("both-ok-dark");
    }
  } else if (mode === "fail") {
    // Corrupt saved key, and block the Nym bundle so the worker boot fails.
    await context.addInitScript(() => localStorage.setItem("mcplus.guestKey", "not-a-key"));
    await context.route("https://cdn.jsdelivr.net/**", (r) => r.abort("blockedbyclient"));
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    report.signFail = await settled(signStatus, 15_000);
    log("sign:", report.signFail);
    report.chainFail = await settled(chainStatus, 300_000);
    log("chain:", report.chainFail);
    report.overflow = await overflow();
    log("overflow", JSON.stringify(report.overflow));
    await shot("failed");
    report.corruptValueKept1 = (await page.evaluate(() => localStorage.getItem("mcplus.guestKey"))) === "not-a-key";
    await page.locator("section", { hasText: "Guest wallet signature" }).getByRole("button", { name: "Run again" }).click();
    report.signFail2 = await settled(signStatus, 15_000);
    report.corruptValueKept2 = (await page.evaluate(() => localStorage.getItem("mcplus.guestKey"))) === "not-a-key";
    // Unblock the bundle and retry the chain read in the same page (no reload).
    await context.unroute("https://cdn.jsdelivr.net/**");
    await page.locator("section", { hasText: "Private chain read" }).getByRole("button", { name: "Run again" }).click();
    await page.waitForTimeout(300);
    report.retryRunningText = (await chainStatus.textContent()).trim();
    log("chain after Run again click:", report.retryRunningText);
    try {
      report.chainRetry = await settled(chainStatus);
    } catch (e) {
      report.chainRetry = `TIMEOUT: ${e.message.split("\n")[0]}`;
    }
    log("chain retry:", report.chainRetry);
    await shot("retry-after-unblock");
  } else if (mode === "bootfail") {
    // Block the mainnet bootstrap read so the Nym worker boot itself fails, then unblock and use Run again.
    const BOOT = "https://ethereum-rpc.publicnode.com/**";
    await context.route(BOOT, (r) => r.abort("connectionrefused"));
    await page.goto(URL_, { waitUntil: "domcontentloaded" });
    report.chainFail = await settled(chainStatus, 300_000);
    log("chain (boot blocked):", report.chainFail);
    await shot("bootfail");
    await context.unroute(BOOT);
    const before = requests.length;
    const clickedAt = Date.now();
    await page.locator("section", { hasText: "Private chain read" }).getByRole("button", { name: "Run again" }).click();
    report.retryRunningText = (await chainStatus.textContent()).trim();
    try {
      report.chainRetry = await settled(chainStatus, 300_000);
    } catch (e) {
      report.chainRetry = `TIMEOUT: ${e.message.split("\n")[0]}`;
    }
    report.retrySeconds = (Date.now() - clickedAt) / 1000;
    report.requestsDuringRetry = requests.slice(before).map((r) => `${r.method} ${hostOf(r.url)}`);
    log("chain after unblock + Run again:", report.chainRetry, report.retrySeconds, "s");
    await shot("bootfail-run-again");
    await page.reload({ waitUntil: "domcontentloaded" });
    try {
      report.chainAfterReload = await settled(chainStatus);
    } catch (e) {
      report.chainAfterReload = `TIMEOUT: ${e.message.split("\n")[0]}`;
    }
    log("chain after reload:", report.chainAfterReload);
  }
} catch (e) {
  report.error = e.message.split("\n")[0];
  log("ERROR", report.error);
  await shot("error").catch(() => {});
}

// Network summary (hosts only; bodies scanned for the key, never printed).
const byHost = {};
for (const r of requests) {
  const k = `${r.method} ${hostOf(r.url)}`;
  byHost[k] = (byHost[k] ?? 0) + 1;
}
report.requestsTotal = requests.length;
report.requestsByHost = byHost;
report.nonLocal = requests.filter((r) => !/^https?:\/\/localhost[:/]/.test(r.url) && !r.url.startsWith("data:") && !r.url.startsWith("blob:")).map((r) => `${r.method} ${r.url}`);
report.ankrHits = requests.filter((r) => /ankr/i.test(r.url)).length;
report.websockets = sockets.map(hostOf);
if (guestKey) {
  const k = guestKey.toLowerCase();
  const bare = k.slice(2);
  report.keyInRequests = requests.filter((r) => (r.url + r.body).toLowerCase().includes(bare)).length;
  report.keyInConsole = consoleLines.filter((l) => l.toLowerCase().includes(bare)).length;
  report.keyInPageHtml = (await page.content()).toLowerCase().includes(bare);
}
report.console = consoleLines.map((l) => (guestKey ? l.split(guestKey.slice(2)).join("<redacted>") : l).slice(0, 200));
await browser.close();
writeFileSync(`${netlog}.report.json`, JSON.stringify(report, null, 2));
log("REPORT", JSON.stringify(report, null, 2));
