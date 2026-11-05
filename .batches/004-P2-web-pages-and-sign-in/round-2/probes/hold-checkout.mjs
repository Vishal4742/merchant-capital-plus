// Tester probe, batch 004 round 1: HoldButton as a money control on the real /checkout page (next start :3100),
// with trusted input (Playwright mouse, keyboard and CDP touch). Counts the browser's POSTs to .../pay.
// The pay POST is answered by Playwright (never reaches our server) except where noted.
// Usage: SID=<open checkout id> node hold-checkout.mjs <out.json>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const BASE = "http://localhost:3100";
const SID = process.env.SID;
const [out] = process.argv.slice(2);
const browser = await chromium.launch();
const res = {};
const refuse = (route) => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "The payment didn't go through. Nothing was charged." }) });

async function open(path, { payRoute = refuse, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 900 }, ...(touch ? { hasTouch: true, isMobile: true } : {}) });
  await ctx.addInitScript(() => {
    window.__draws = 0;
    for (const P of [window.WebGL2RenderingContext, window.WebGLRenderingContext].filter(Boolean)) {
      const d = P.prototype.drawArrays;
      P.prototype.drawArrays = function (...a) { window.__draws++; return d.apply(this, a); };
    }
  });
  const posts = [];
  ctx.on("request", (r) => r.method() === "POST" && /\/pay$/.test(r.url()) && posts.push({ at: Date.now(), body: JSON.parse(r.postData() ?? "{}") }));
  await ctx.route("**/api/v1/sessions/*/pay", payRoute);
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(1500); // signer loads at idle
  const btn = page.getByRole("button", { name: /Hold to pay|Paying|Paid/ });
  const center = async () => { const b = await btn.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2, b]; };
  const label = async () => (await btn.count()) ? (await btn.textContent()).trim() : null;
  return { ctx, page, btn, posts, center, label, close: () => ctx.close() };
}
const wait = (p, ms) => p.waitForTimeout(ms);

// A. control: a full mouse hold confirms once
{
  const t = await open(`/checkout/${SID}`);
  const [x, y] = await t.center();
  await t.page.mouse.move(x, y); await t.page.mouse.down(); await wait(t.page, 1200); await t.page.mouse.up(); await wait(t.page, 800);
  res.A_controlHold = { posts: t.posts.length, labelAfter: await t.label() };
  await t.close();
}
// B. window blur mid-hold cancels (synthetic blur: Playwright emulates focus, so a real one never fires headless)
{
  const t = await open(`/checkout/${SID}`);
  const [x, y] = await t.center();
  await t.page.mouse.move(x, y); await t.page.mouse.down(); await wait(t.page, 400);
  await t.page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await wait(t.page, 900); await t.page.mouse.up(); await wait(t.page, 300);
  res.B_blurMidHold = { posts: t.posts.length, label: await t.label() };
  await t.close();
}
// C. hidden tab mid-hold cancels
{
  const t = await open(`/checkout/${SID}`);
  const [x, y] = await t.center();
  await t.page.mouse.move(x, y); await t.page.mouse.down(); await wait(t.page, 400);
  await t.page.evaluate(() => { Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await wait(t.page, 900); await t.page.mouse.up(); await wait(t.page, 300);
  res.C_hiddenMidHold = { posts: t.posts.length, label: await t.label() };
  await t.close();
}
// D. touch: a 1.2 s hold confirms; drifting 8 px past the edge (inside the 12 px slop) still confirms; 40 px out cancels
{
  for (const [name, dy] of [["touchHold", 0], ["touchDrift8pxOut", "edge+8"], ["touchDrift40pxOut", "edge+40"]]) {
    const t = await open(`/checkout/${SID}`, { touch: true });
    const cdp = await t.ctx.newCDPSession(t.page);
    const [x, y, b] = await t.center();
    const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    await touch("touchStart", [{ x, y, id: 1 }]); await wait(t.page, 200);
    if (dy !== 0) { const ny = b.y + b.height + Number(String(dy).split("+")[1]); await touch("touchMove", [{ x, y: ny, id: 1 }]); }
    await wait(t.page, 1100); await touch("touchEnd", []); await wait(t.page, 800);
    res[`D_${name}`] = { posts: t.posts.length };
    await t.close();
  }
}
// E. Enter held with auto-repeat for 2 s: one confirm
{
  const t = await open(`/checkout/${SID}`, { payRoute: async (route) => { await new Promise((r) => setTimeout(r, 2500)); return refuse(route); } });
  const cdp = await t.ctx.newCDPSession(t.page);
  await t.btn.focus();
  const key = (type, autoRepeat = false) => cdp.send("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: type === "keyDown" ? "\r" : undefined, autoRepeat });
  await key("keyDown");
  for (let i = 0; i < 60; i++) { await key("keyDown", true); await wait(t.page, 33); }
  await key("keyUp"); await wait(t.page, 3000);
  res.E_enterHeld2s = { posts: t.posts.length, label: await t.label() };
  await t.close();
}
// F. one salt per checkout: two refused attempts in the same tab sign with the same salt; validBefore is now + 465 s
{
  const t = await open(`/checkout/${SID}`);
  await t.btn.focus(); await t.page.keyboard.press("Enter"); await wait(t.page, 1500);
  await t.btn.focus(); await t.page.keyboard.press("Enter"); await wait(t.page, 1500);
  const [a, b] = t.posts;
  res.F_saltReuse = {
    posts: t.posts.length,
    sameSalt: Boolean(a && b && a.body.salt === b.body.salt),
    sameFrom: Boolean(a && b && a.body.from === b.body.from),
    validBeforeMinusNow: a ? Number(a.body.validBefore) - Math.floor(a.at / 1000) : null,
    keys: a ? Object.keys(a.body).sort() : null,
  };
  await t.close();
}
// G. success leaves the receipt, never an idle button
{
  const t = await open(`/checkout/${SID}`, { payRoute: (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ receiptId: SID, txHash: `0x${"ab".repeat(32)}` }) }) });
  await t.btn.focus(); await t.page.keyboard.press("Enter"); await wait(t.page, 2500);
  res.G_success = { posts: t.posts.length, holdButtons: await t.page.getByRole("button").count(), paidPill: await t.page.getByText("Paid", { exact: true }).count(), receiptHref: await t.page.getByRole("link", { name: "View receipt" }).getAttribute("href") };
  await t.close();
}
// H. a 409 ("already being paid") hides the button for good on this page
{
  const t = await open(`/checkout/${SID}`, { payRoute: (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "This checkout is already being paid." }) }) });
  await t.btn.focus(); await t.page.keyboard.press("Enter"); await wait(t.page, 2000);
  res.H_409 = { posts: t.posts.length, buttons: await t.page.getByRole("button").count(), alert: (await t.page.getByRole("alert").allInnerTexts()).filter(Boolean) };
  await t.close();
}
// I. route hidden and shown again while a payment is in flight (Next keeps it in <Activity>): no second POST
{
  const t = await open("/", { payRoute: async (route) => { await new Promise((r) => setTimeout(r, 6000)); return refuse(route); } });
  await t.page.getByRole("button", { name: "Try a checkout" }).click();
  await t.page.waitForURL(/\/checkout\//, { timeout: 15000 });
  await wait(t.page, 2000);
  const btn = t.page.getByRole("button", { name: /Hold to pay|Paying/ });
  await btn.focus(); await t.page.keyboard.press("Enter"); await wait(t.page, 300);
  const labelInFlight = (await btn.textContent()).trim();
  await t.page.goBack(); await wait(t.page, 1000);
  const onHome = t.page.url();
  await t.page.goForward(); await wait(t.page, 1000);
  const labelBack = (await t.page.getByRole("button").first().textContent()).trim();
  const b2 = t.page.getByRole("button").first();
  await b2.focus(); await t.page.keyboard.press("Enter");
  const bb = await b2.boundingBox(); await t.page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await t.page.mouse.down(); await wait(t.page, 1200); await t.page.mouse.up();
  await wait(t.page, 6000);
  res.I_hiddenWhileBusy = { labelInFlight, onHome: onHome.replace(BASE, ""), labelBack, posts: t.posts.length, labelAfterReply: (await t.page.getByRole("button").first().textContent()).trim(), alert: (await t.page.getByRole("alert").allInnerTexts()).filter(Boolean) };
  await t.close();
}
// J. the home scene still draws after its hidden route is shown again
{
  const t = await open("/");
  await wait(t.page, 1500);
  const d0 = await t.page.evaluate(() => window.__draws);
  await t.page.getByRole("link", { name: "Dashboard", exact: true }).click(); await t.page.waitForURL(/\/merchant/); await wait(t.page, 1000);
  const dHidden = await t.page.evaluate(() => window.__draws);
  await wait(t.page, 800);
  const dHidden2 = await t.page.evaluate(() => window.__draws);
  await t.page.goBack(); await t.page.waitForURL(`${BASE}/`); await wait(t.page, 1500);
  const dBack = await t.page.evaluate(() => window.__draws);
  const lost = await t.page.evaluate(() => { const c = document.querySelector("canvas"); const gl = c?.getContext("webgl2") ?? c?.getContext("webgl"); return gl ? gl.isContextLost() : "no-gl"; });
  res.J_sceneAfterShow = { drawsBeforeHide: d0, drawsWhileHidden: dHidden2 - dHidden, drawsAfterShow: dBack - dHidden2, contextLost: lost };
  await t.close();
}
console.log(JSON.stringify(res, null, 1));
writeFileSync(out, JSON.stringify(res, null, 1));
await browser.close();
