// Tester (batch 003 round 1): look up the probe's tx, entity and writer on the public Rabdi explorer UI.
// Usage: node explorer.mjs <path-on-explorer> <shotName> [waitMs]
// Public pages only; uses no key. Prints the page title, final URL and visible text (trimmed).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const [path, shot, waitArg] = process.argv.slice(2);
const base = "https://rabdi.explorer.arkiv.network";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const res = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 45_000 });
await page.waitForTimeout(Number(waitArg ?? 8000));
const text = (await page.innerText("body")).replace(/\n{2,}/g, "\n").slice(0, 4000);
const links = await page.$$eval("a[href]", (as) => [...new Set(as.map((a) => a.getAttribute("href")))].slice(0, 60));
await page.screenshot({ path: new URL(`../shots/${shot}.png`, import.meta.url).pathname, fullPage: true });
console.log(JSON.stringify({ status: res?.status(), url: page.url(), title: await page.title() }));
console.log("--- text\n" + text);
console.log("--- links\n" + links.join("\n"));
await browser.close();
