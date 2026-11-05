// Tester walkthrough for batch 002 round 1 (design foundation).
// Usage: node walk.mjs <views|hold|touch|reduced|motion|nowebgl|nothree|cleanup> <width> <shotsDir> <outJson>
// views waits for the real Nym read (DEP-6); the other modes block the mainnet bootstrap to keep the network quiet.
// Never prints the guest key or any .env value.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const [mode, widthArg, shots, out] = process.argv.slice(2);
const width = Number(widthArg);
const URL_ = process.env.APP_URL ?? "http://localhost:3100/";
const t0 = Date.now();
const log = (...a) => console.log(`[${mode}-${width} +${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const hostOf = (u) => { try { return new URL(u).host || u.slice(0, 30); } catch { return u.slice(0, 30); } };

const launchArgs = {
  nowebgl: ["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"],
  nowebgl2: ["--use-gl=disabled", "--use-angle=disabled"],
}[process.env.GL ?? (mode === "nowebgl" ? "nowebgl" : "")] ?? [];
const browser = await chromium.launch({ args: launchArgs });
const ctxOpts = { viewport: { width, height: Number(process.env.H ?? 900) }, colorScheme: process.env.SCHEME ?? "light" };
if (mode === "reduced") ctxOpts.reducedMotion = "reduce";
if (mode === "touch") Object.assign(ctxOpts, { hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const context = await browser.newContext(ctxOpts);
await context.addInitScript(() => {
  window.__gl = { contexts: 0, lost: 0, ctx2d: 0, draws: 0 };
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = orig.call(this, type, ...rest);
    if (c && /webgl/.test(type) && !this.__counted) {
      this.__counted = true;
      window.__gl.contexts++;
      this.addEventListener("webglcontextlost", () => window.__gl.lost++);
    }
    if (c && type === "2d" && !this.__c2) { this.__c2 = true; window.__gl.ctx2d++; }
    return c;
  };
  for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean)) {
    const d = P.prototype.drawArrays;
    P.prototype.drawArrays = function (...a) { window.__gl.draws++; return d.apply(this, a); };
  }
});
const requests = [];
const consoleLines = [];
context.on("request", (r) => requests.push({ url: r.url(), method: r.method() }));
if (mode !== "views") await context.route("https://ethereum-rpc.publicnode.com/**", (r) => r.abort("connectionrefused"));
let threeChunk = null;
if (mode === "nothree") {
  await context.route("**/_next/static/chunks/*.js", async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    if (body.includes("WebGLRenderer") && !body.includes("Hold to sign again")) { threeChunk = route.request().url(); return route.abort("failed"); }
    return route.fulfill({ response: res, body });
  });
}
const page = await context.newPage();
const ts = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;
page.on("console", (m) => consoleLines.push(`${ts()} ${m.type()}: ${m.text().slice(0, 300)}`));
page.on("pageerror", (e) => consoleLines.push(`${ts()} pageerror: ${e.message}`));
const diffPage = await context.newPage();

const section = (title) => page.locator("section", { hasText: title }).last();
const chain = section("Private chain read");
const sign = section("Guest wallet signature");
const status = (s) => s.locator('[role="status"]');
const holdBtn = () => sign.getByRole("button");
const settled = async (s, timeout) => {
  await page.waitForFunction((el) => /\S/.test(el.textContent ?? "") && !/Connecting|Signing…/.test(el.textContent ?? ""), await status(s).elementHandle(), { timeout, polling: 250 });
  return (await s.locator("p").first().textContent()).trim();
};
const pillOf = async (s) => (await s.locator("span.rounded-pill").first().textContent()).trim();
const shot = async (name, opts = {}) => {
  const p = `${shots}/tester-${width}-${name}.png`;
  await page.screenshot({ path: p, fullPage: true, ...opts });
  log("shot", p);
};
const canvasPng = () => page.locator("canvas").first().screenshot();
// Pixel stats on PNG buffers, decoded in a blank page.
const pix = (a, b) => diffPage.evaluate(async ([a64, b64]) => {
  const load = async (s) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext("2d");
    x.drawImage(bm, 0, 0);
    return x.getImageData(0, 0, bm.width, bm.height);
  };
  const A = await load(a64);
  let blue = 0;
  for (let i = 0; i < A.data.length; i += 4) if (A.data[i + 2] > A.data[i] + 60) blue++;
  const r = { w: A.width, h: A.height, bluePixels: blue };
  if (b64) {
    const B = await load(b64);
    let n = 0;
    for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 30) n++;
    r.differingPixels = n;
    r.differingShare = +(n / (A.width * A.height)).toFixed(5);
  }
  return r;
}, [a.toString("base64"), b ? b.toString("base64") : null]);
const gl = () => page.evaluate(() => ({ ...window.__gl }));
const drawsOver = async (ms) => { const a = (await gl()).draws; await page.waitForTimeout(ms); return (await gl()).draws - a; };

// WCAG contrast of every visible text node against its composited background (and the dot colour inside the scene).
const auditContrast = () => page.evaluate(() => {
  const toRGBA = (s) => {
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = s.match(/^color\(srgb ([^)]+)\)$/);
    if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    return null;
  };
  const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const c = toRGBA(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
    }
    let bg = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) bg = over(stack[i], bg);
    return bg;
  };
  const dot = toRGBA(getComputedStyle(document.documentElement).getPropertyValue("--scene-dot").trim().replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`));
  const hero = document.querySelector("main > section");
  const rows = [];
  for (const el of document.querySelectorAll("body *")) {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!own || el.getClientRects().length === 0) continue;
    const cs = getComputedStyle(el);
    const fg = toRGBA(cs.color);
    if (!fg) { rows.push({ text: own.slice(0, 40), unparsed: cs.color }); continue; }
    let op = 1;
    for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    const bg = bgOf(el);
    const eff = over([fg[0], fg[1], fg[2], fg[3] * op], bg);
    const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = { text: own.slice(0, 40), size, weight, ratio: ratio(eff, bg), need, pass: ratio(eff, bg) >= need };
    if (hero?.contains(el) && dot) { const effD = over([fg[0], fg[1], fg[2], fg[3] * op], dot); r.ratioOverDot = ratio(effD, dot); r.passOverDot = r.ratioOverDot >= need; }
    rows.push(r);
  }
  return rows;
});

const report = { mode, width, scheme: ctxOpts.colorScheme, launchArgs };
try {
  await page.goto(URL_, { waitUntil: "domcontentloaded" });
  if (mode === "views") {
    await page.waitForTimeout(2600);
    report.gl = await gl();
    report.fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const h1 = getComputedStyle(document.querySelector("h1"));
      const em = getComputedStyle(document.querySelector("h1 .emphasis"));
      const data = getComputedStyle(document.querySelector(".data"));
      return {
        loaded: [...document.fonts].filter((f) => f.status === "loaded").map((f) => `${f.family} ${f.style} ${f.weight}`),
        h1: h1.fontFamily.slice(0, 80), emphasis: `${em.fontFamily.slice(0, 60)} ${em.fontStyle}`, data: data.fontFamily.slice(0, 60),
      };
    });
    report.overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
    report.buttons = await page.evaluate(() => [...document.querySelectorAll("button")].map((b) => {
      const cs = getComputedStyle(b);
      return { text: b.textContent, h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width), radius: cs.borderRadius, padding: cs.padding, bg: cs.backgroundColor, color: cs.color };
    }));
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      await shot(`${scheme}-load`);
      report[`contrast_${scheme}_load`] = (await auditContrast()).filter((r) => !r.pass || r.passOverDot === false || r.unparsed);
    }
    report.sign = await settled(sign, 15_000);
    log("sign:", report.sign);
    report.chain = await settled(chain, 300_000);
    report.chainPill = await pillOf(chain);
    log("chain:", report.chain, report.chainPill);
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(300);
      await shot(`${scheme}-settled`);
      const rows = await auditContrast();
      report[`contrast_${scheme}_settled_all`] = rows;
      report[`contrast_${scheme}_settled_fail`] = rows.filter((r) => !r.pass || r.passOverDot === false || r.unparsed);
    }
    // keyboard focus ring on both buttons
    await page.keyboard.press("Tab");
    report.focusRing = [];
    for (let i = 0; i < 4; i++) {
      report.focusRing.push(await page.evaluate(() => { const a = document.activeElement; const cs = getComputedStyle(a); return { tag: a.tagName, text: a.textContent?.slice(0, 30), outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, offset: cs.outlineOffset }; }));
      if (i === 0) await shot("focus-1", { fullPage: false });
      await page.keyboard.press("Tab");
    }
  } else if (mode === "hold") {
    report.sign = await settled(sign, 15_000);
    const btn = holdBtn();
    const box = await btn.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    // Timeline of the button label, aria-disabled and the status text, from a MutationObserver.
    await page.evaluate(() => {
      const sec = [...document.querySelectorAll("section")].find((s) => s.textContent.includes("Guest wallet signature"));
      const b = sec.querySelector("button"), st = sec.querySelector('[role="status"]');
      window.__tl = [];
      window.__t0 = performance.now();
      const snap = () => {
        const last = window.__tl.at(-1);
        const cur = { label: b.textContent, aria: b.getAttribute("aria-disabled"), dots: b.querySelectorAll("i").length, status: st.textContent.slice(0, 40), focusOnBtn: document.activeElement === b };
        if (!last || last.label !== cur.label || last.aria !== cur.aria || last.status !== cur.status || last.dots !== cur.dots) window.__tl.push({ t: Math.round(performance.now() - window.__t0), ...cur });
      };
      new MutationObserver(snap).observe(sec, { subtree: true, childList: true, characterData: true, attributes: true });
      window.__mark = () => { window.__tl = []; window.__t0 = performance.now(); snap(); };
      window.__fill = () => getComputedStyle(b.querySelector("span[aria-hidden]")).transform;
    });
    const tl = () => page.evaluate(() => window.__tl);
    const mark = () => page.evaluate(() => window.__mark());
    const fill = () => page.evaluate(() => window.__fill());
    const cdp = await context.newCDPSession(page);

    // A: release at 400 ms cancels
    await page.mouse.move(cx, cy);
    await mark();
    await page.mouse.down();
    await page.waitForTimeout(200);
    const fillAt200 = await fill();
    await shot("hold-200ms", { fullPage: false, clip: { x: box.x - 20, y: box.y - 120, width: box.width + 40, height: box.height + 140 } });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await page.waitForTimeout(1200);
    report.A_release400 = { fillAt200, fillAfter: await fill(), timeline: await tl() };

    // B: hold about 1 s confirms
    await mark();
    await page.mouse.down();
    await page.waitForTimeout(450);
    const fillAt450 = await fill();
    await page.waitForTimeout(550);
    await page.mouse.up();
    await page.waitForTimeout(1500);
    report.B_hold1000 = { fillAt450, timeline: await tl() };

    // B2: same, with the CPU throttled 20x so the busy state is long enough to see
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await mark();
    await page.mouse.down();
    await page.waitForTimeout(1100);
    await page.mouse.up();
    await page.waitForTimeout(150);
    await shot("hold-busy-throttled", { fullPage: false, clip: { x: box.x - 20, y: box.y - 120, width: box.width + 40, height: box.height + 140 } });
    // A pointer press while busy must be ignored
    await page.mouse.down();
    await page.waitForTimeout(1100);
    await page.mouse.up();
    await page.waitForTimeout(6000);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await page.waitForTimeout(1000);
    report.B2_hold_throttled = { timeline: await tl() };

    // C: leaving the button mid-hold cancels
    await page.mouse.move(cx, cy);
    await mark();
    await page.mouse.down();
    await page.waitForTimeout(300);
    await page.mouse.move(cx, cy + 200);
    await page.waitForTimeout(1000);
    await page.mouse.up();
    await page.waitForTimeout(300);
    report.C_leave = { timeline: await tl() };

    // D: keyboard Enter confirms at once and focus stays (plain and throttled)
    for (const [key, rate] of [["Enter", 1], ["Space", 1], ["Enter", 20]]) {
      await page.mouse.move(5, 5);
      await btn.focus();
      if (rate !== 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate });
      await mark();
      await page.keyboard.press(key);
      const focus = [];
      for (const wait of [0, 30, 100, 300, 800]) {
        await page.waitForTimeout(wait);
        focus.push(await page.evaluate(() => document.activeElement?.textContent?.slice(0, 30) ?? null));
      }
      if (rate !== 1) { await page.waitForTimeout(5000); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); }
      await page.waitForTimeout(800);
      report[`D_${key}_x${rate}`] = { focusSamples: focus, focusAfter: await page.evaluate(() => document.activeElement?.textContent?.slice(0, 30)), timeline: await tl() };
    }

    // E: a rejected onConfirm (unreadable saved key) goes back to idle, by pointer and by keyboard
    await page.evaluate(() => localStorage.setItem("mcplus.guestKey", "not-a-key"));
    await page.mouse.move(cx, cy);
    await mark();
    await page.mouse.down();
    await page.waitForTimeout(1100);
    await page.mouse.up();
    await page.waitForTimeout(1000);
    report.E_reject_pointer = { timeline: await tl(), pill: await pillOf(sign) };
    await shot("hold-rejected", { fullPage: false, clip: { x: box.x - 40, y: box.y - 200, width: box.width + 400, height: box.height + 220 } });
    await btn.focus();
    await mark();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    report.E_reject_keyboard = { timeline: await tl(), focusAfter: await page.evaluate(() => document.activeElement?.textContent?.slice(0, 30)) };
  } else if (mode === "touch") {
    report.sign = await settled(sign, 15_000);
    const box = await holdBtn().boundingBox();
    const pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const cdp = await context.newCDPSession(page);
    await page.evaluate(() => {
      const sec = [...document.querySelectorAll("section")].find((s) => s.textContent.includes("Guest wallet signature"));
      const b = sec.querySelector("button");
      window.__ev = [];
      for (const t of ["pointerdown", "pointerup", "pointercancel", "pointerleave", "click", "contextmenu"]) b.addEventListener(t, (e) => window.__ev.push(`${t}${e.pointerType ? `:${e.pointerType}` : ""}${t === "click" ? `:detail=${e.detail}` : ""}`));
      window.__labels = [];
      new MutationObserver(() => { if (window.__labels.at(-1) !== b.textContent) window.__labels.push(b.textContent); }).observe(b, { subtree: true, childList: true, characterData: true });
    });
    const touch = async (ms) => {
      await page.evaluate(() => { window.__ev = []; window.__labels = []; });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [pt] });
      await page.waitForTimeout(ms);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(1200);
      return page.evaluate(() => ({ events: window.__ev, labels: window.__labels }));
    };
    report.tap300 = await touch(300);
    report.press1100 = await touch(1100);
    await shot("touch-after", { fullPage: false });
  } else if (mode === "reduced" || mode === "motion") {
    const a0 = await canvasPng();
    await page.waitForTimeout(700);
    const a1 = await canvasPng();
    report.gather_0_to_700ms = await pix(a0, a1);
    await page.waitForTimeout(2500);
    report.gl = await gl();
    report.drawsPerSecond = await drawsOver(1000);
    const s0 = await canvasPng();
    await page.waitForTimeout(700);
    const s1 = await canvasPng();
    report.settled_700ms_noMouse = await pix(s0, s1);
    const box = await page.locator("canvas").first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 5 });
    await page.waitForTimeout(1200);
    const m1 = await canvasPng();
    report.mouseIn_vs_noMouse = await pix(s1, m1);
    await page.screenshot({ path: `${shots}/tester-${width}-${mode}-scene-mouse.png` });
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 5 });
    await page.waitForTimeout(1200);
    const m2 = await canvasPng();
    report.mouseMoved = await pix(m1, m2);
    await page.mouse.move(5, box.y + box.height + 400);
    report.cssAnimations = await page.evaluate(() => document.getAnimations().length);
  } else if (mode === "nowebgl" || mode === "nothree") {
    await page.waitForTimeout(3500);
    report.gl = await gl();
    report.webgl2Available = await page.evaluate(() => !!document.createElement("canvas").getContext("webgl2"));
    report.threeChunkBlocked = threeChunk ? hostOf(threeChunk) + new URL(threeChunk).pathname : null;
    const c = await canvasPng();
    report.canvas = await pix(c);
    report.canvasSize = await page.evaluate(() => { const c = document.querySelector("canvas"); return { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight }; });
    report.sign = await settled(sign, 15_000);
    report.pageUsable = await holdBtn().isVisible();
    await shot(`${mode}${process.env.GL === "nowebgl2" ? "-usegl-disabled" : ""}`);
  } else if (mode === "cleanup") {
    await page.waitForTimeout(2500);
    report.hasRouter = await page.evaluate(() => typeof window.next?.router?.push);
    report.start = await gl();
    report.drawsVisible = await drawsOver(1000);
    // Off-screen pause: scroll the scene out of view (short viewport)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    report.heroBottomAfterScroll = await page.evaluate(() => Math.round(document.querySelector("main > section").getBoundingClientRect().bottom));
    report.drawsOffscreen = await drawsOver(1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    report.drawsBackOnScreen = await drawsOver(1000);
    const N = Number(process.env.N ?? 20);
    report.cycles = [];
    await page.evaluate(() => { window.__sameDocument = true; });
    const away = process.env.AWAY ?? "/_not-found";
    for (let i = 0; i < N; i++) {
      await page.evaluate((a) => window.next.router.push(a), away);
      await page.waitForFunction(() => !document.querySelector("canvas"), null, { timeout: 10_000 });
      const awayDraws = await drawsOver(300);
      await page.evaluate(() => window.next.router.back());
      await page.waitForFunction(() => !!document.querySelector("canvas"), null, { timeout: 10_000 });
      await page.waitForTimeout(400);
      report.cycles.push({ i, awayDraws, sameDocument: await page.evaluate(() => window.__sameDocument === true), ...(await gl()) });
    }
    report.end = await gl();
    report.drawsVisibleAtEnd = await drawsOver(1000);
    await page.waitForTimeout(500);
    await shot("cleanup-after-cycles", { fullPage: false });
    report.contextLostWarnings = consoleLines.filter((l) => /Too many active WebGL contexts|context lost|CONTEXT_LOST/i.test(l)).length;
  }
} catch (e) {
  report.error = e.message.split("\n").slice(0, 3).join(" | ");
  log("ERROR", report.error);
  await shot("error").catch(() => {});
}
report.requestHosts = Object.entries(requests.reduce((m, r) => ({ ...m, [hostOf(r.url)]: (m[hostOf(r.url)] ?? 0) + 1 }), {}));
report.googleFontRequests = requests.filter((r) => /fonts\.(googleapis|gstatic)\.com/.test(r.url)).length;
report.ankrRequests = requests.filter((r) => /rpc\.ankr\.com/.test(r.url)).length;
report.console = consoleLines;
await browser.close();
writeFileSync(out, JSON.stringify(report, null, 2));
log("done", out);
