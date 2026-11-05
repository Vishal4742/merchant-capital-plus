// Tester lab run for NFR-12 / NFR-13 (batch 004 round 1). NOT Lighthouse: Lighthouse isn't installed (adding it needs
// the human). Playwright + CDP with Lighthouse's mobile profile: 412x823 at DPR 1.75, a mobile UA, 150 ms RTT,
// 1.6 Mbps down, 750 Kbps up (devtools throttling, so stricter than Lighthouse's simulated default), CPU 4x slowdown,
// a cold cache per run.
// Usage: node perf.mjs <path> <runs> <out.json> [idleMs]
// Records FCP, LCP (largest-contentful-paint), CLS, long tasks + TBT (sum of task time over 50 ms after FCP), a lab
// INP proxy (the longest event-timing entry of one tap on the first button: a tap never confirms a HoldButton), and
// the compressed JS bytes (encodedBodySize of .js resources after idle), plus when each script started vs FCP.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const [path, runsArg, out, idleArg] = process.argv.slice(2);
const BASE = "http://localhost:3100";
const runs = Number(runsArg ?? 3);
const idleMs = Number(idleArg ?? 8000);
const UA = "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

// classify each script once by its body: three.js, the Nym harness, the signer (viem signing)
const kinds = new Map();
async function kindOf(url) {
  if (kinds.has(url)) return kinds.get(url);
  let kind = "app";
  if (!url.startsWith(BASE)) kind = "third-party";
  else {
    const body = await (await fetch(url)).text();
    if (body.includes("WebGLRenderer")) kind = "three.js";
    else if (/anon-rpc|nym-|mixnet|NymClient|wasm_bindgen/i.test(body)) kind = "nym";
    else if (body.includes("mcplus.salt.")) kind = "signer";
  }
  kinds.set(url, kind);
  return kind;
}

const browser = await chromium.launch();
const all = [];
for (let i = 0; i < runs; i++) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 823 }, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true, userAgent: UA });
  await ctx.addInitScript(() => {
    window.__m = { lcp: 0, lcpEl: null, cls: 0, long: [], events: [], csp: 0 };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__m.lcp = e.startTime; window.__m.lcpEl = e.element ? `${e.element.tagName.toLowerCase()}.${String(e.element.className).slice(0, 40)}` : e.url; })).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__m.cls += e.value; })).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__m.long.push([e.startTime, e.duration]))).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__m.events.push([e.name, e.duration]))).observe({ type: "event", buffered: true, durationThreshold: 16 });
    document.addEventListener("securitypolicyviolation", () => window.__m.csp++);
  });
  // DOC_DELAY_MS: hold the HTML back this long, standing in for DNS + TCP + request round trips that devtools
  // throttling doesn't add to the navigation here (its responseStart reads ~2 ms)
  if (process.env.DOC_DELAY_MS) await ctx.route(BASE + path, async (route) => { await new Promise((r) => setTimeout(r, Number(process.env.DOC_DELAY_MS))); return route.continue(); });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const t0 = Date.now();
  await page.goto(BASE + path, { waitUntil: "load", timeout: 120_000 });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(idleMs); // the idle signer, the scene, and anything else that loads late
  // one tap on the first button (a HoldButton tap is a cancelled hold, never a confirm)
  const btn = page.locator("main button").first();
  let tapped = false;
  if (await btn.count()) {
    await btn.tap().catch(() => {});
    tapped = true;
    await page.waitForTimeout(1500);
  }
  const m = await page.evaluate(() => {
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const res = performance.getEntriesByType("resource").map((e) => ({ name: e.name, start: Math.round(e.startTime), end: Math.round(e.responseEnd), enc: e.encodedBodySize, dec: e.decodedBodySize, type: e.initiatorType }));
    const nav = performance.getEntriesByType("navigation")[0];
    return { fcp, ...window.__m, res, navEnc: nav?.encodedBodySize, ttfb: nav ? Math.round(nav.responseStart) : null };
  });
  const scripts = [];
  for (const r of m.res.filter((r) => /\.js(\?|$)/.test(r.name) || r.type === "script")) scripts.push({ ...r, kind: await kindOf(r.name), afterFcp: m.fcp !== null && r.start > m.fcp });
  const tbt = m.long.filter(([s]) => m.fcp === null || s >= m.fcp).reduce((sum, [, d]) => sum + Math.max(0, d - 50), 0);
  const run = {
    run: i + 1,
    path,
    loadMs,
    ttfb: m.ttfb,
    fcp: Math.round(m.fcp),
    lcp: Math.round(m.lcp),
    lcpEl: m.lcpEl,
    cls: Number(m.cls.toFixed(4)),
    longTasks: m.long.length,
    tbt: Math.round(tbt),
    inpProxy: tapped ? Math.round(Math.max(0, ...m.events.map(([, d]) => d))) : null,
    events: m.events,
    jsBytes: scripts.reduce((s, r) => s + r.enc, 0),
    jsCount: scripts.length,
    byKind: Object.fromEntries([...new Set(scripts.map((s) => s.kind))].map((k) => [k, scripts.filter((s) => s.kind === k).reduce((s, r) => s + r.enc, 0)])),
    late: scripts.filter((s) => s.kind !== "app").map((s) => ({ kind: s.kind, start: s.start, afterFcp: s.afterFcp, enc: s.enc, file: s.name.split("/").pop() })),
    offOrigin: m.res.filter((r) => !r.name.startsWith(BASE)).map((r) => r.name.slice(0, 60)),
    csp: m.csp,
    htmlEnc: m.navEnc,
  };
  all.push({ ...run, scripts });
  console.log(JSON.stringify({ run: run.run, path, fcp: run.fcp, lcp: run.lcp, lcpEl: run.lcpEl, cls: run.cls, tbt: run.tbt, inp: run.inpProxy, js: run.jsBytes, n: run.jsCount, byKind: run.byKind, late: run.late, off: run.offOrigin.length, csp: run.csp }));
  await ctx.close();
}
writeFileSync(out, JSON.stringify(all, null, 1));
await browser.close();
