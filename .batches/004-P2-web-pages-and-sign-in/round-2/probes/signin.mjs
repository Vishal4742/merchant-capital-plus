// Tester probe, batch 004 round 1: merchant sign-in (FR-PAY-15) end to end in Chromium on /merchant, with an injected
// EIP-1193 provider whose key is generated in this process for this run only (never written or printed; it is not
// MERCHANT_ADDRESS, so the dashboard must show the "demo shop is paid to ..." note and no payments).
// Also: the "no browser wallet" message, sign-out, cookie flags, and a replay of the captured verify request.
// Usage: node signin.mjs <out.json>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const webRequire = createRequire("/Users/vg890/ethglobal/apps/web/package.json");
const { generatePrivateKey, privateKeyToAccount } = webRequire("viem/accounts");
const BASE = "http://localhost:3100";
const SHOTS = new URL("../shots/", import.meta.url).pathname;
const [out] = process.argv.slice(2);
const account = privateKeyToAccount(generatePrivateKey());
const res = { testWallet: `${account.address.slice(0, 6)}…${account.address.slice(-4)}` };
const browser = await chromium.launch();

// 1. no provider: plain message, no request
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/merchant`);
  await page.getByRole("button", { name: "Sign in with your wallet" }).click();
  await page.waitForTimeout(500);
  res.noProvider = (await page.getByRole("alert").allInnerTexts()).filter(Boolean);
  await ctx.close();
}

// 2. provider present: sign in, look, sign out (1440 and 375)
for (const width of [1440, 375]) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 812 : 900 } });
  await ctx.exposeFunction("__probeSign", (hex) => account.signMessage({ message: { raw: hex } }));
  await ctx.addInitScript((addr) => {
    window.__rpc = [];
    window.ethereum = {
      request: async ({ method, params }) => {
        window.__rpc.push(method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [addr];
        if (method === "eth_chainId") return "0x752";
        if (method === "personal_sign") return window.__probeSign(params[0]);
        throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
      },
      on() {},
      removeListener() {},
    };
  }, account.address);
  let verifyReq = null;
  // allHeaders(): the Cookie header is added by the network stack, so headers() alone doesn't carry it
  ctx.on("request", async (r) => { if (r.url().endsWith("/api/auth/verify")) verifyReq = { body: r.postData(), cookie: (await r.allHeaders())["cookie"] ?? null }; });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/merchant`);
  await page.screenshot({ path: `${SHOTS}merchant-gate-before-${width}.png`, fullPage: true });
  await page.getByRole("button", { name: "Sign in with your wallet" }).click();
  await page.getByText("Signed in as").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const text = (await page.innerText("main")).replace(/\s+/g, " ");
  const cookies = await ctx.cookies(BASE);
  const session = cookies.find((c) => c.name === "mc_session");
  const r = {
    rpc: await page.evaluate(() => window.__rpc),
    signedInShown: text.includes(res.testWallet),
    demoShopNote: /The demo shop is paid to 0x\w{4}…\w{4}, not this wallet/.test(text),
    salesLabel: text.includes("Sales, before fees"),
    payments: /No payments yet/.test(text) ? "none listed" : "listed",
    relayerCard: /Relayer balance|isn't answering|isn't connected/.exec(text)?.[0] ?? null,
    unswapped: text.includes("Fees not yet swapped"),
    sessionCookie: session ? { httpOnly: session.httpOnly, sameSite: session.sameSite, secure: session.secure, ttlH: Math.round((session.expires - Date.now() / 1000) / 360) / 10 } : null,
    nonceCookieLeft: cookies.some((c) => c.name === "mc_nonce"),
    scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth),
    text: text.slice(0, 700),
  };
  await page.screenshot({ path: `${SHOTS}merchant-signed-in-${width}-light.png`, fullPage: true });
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Sign in with your wallet" }).waitFor({ timeout: 10000 });
  r.afterSignOut = { gate: true, sessionCookie: (await ctx.cookies(BASE)).some((c) => c.name === "mc_session") };
  // replay the captured verify request (same nonce cookie, message and signature) after the browser cleared it
  if (verifyReq && width === 1440) {
    const replay = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", cookie: verifyReq.cookie ?? "" }, body: verifyReq.body });
    r.replaySameRequest = { status: replay.status, setsSession: (replay.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("mc_session=") && !c.startsWith("mc_session=;")) };
    const noCookie = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: verifyReq.body });
    r.replayWithoutCookie = noCookie.status;
    const plain = await fetch(`${BASE}/api/auth/verify`, { method: "POST", headers: { "content-type": "application/json", cookie: `mc_nonce=${JSON.parse(verifyReq.body).message.match(/Nonce: (\w+)/)[1]}` }, body: verifyReq.body });
    r.replayWithPlainNonceCookie = plain.status;
  }
  res[`signIn${width}`] = r;
  await ctx.close();
}
console.log(JSON.stringify(res, null, 1));
writeFileSync(out, JSON.stringify(res, null, 1));
await browser.close();
