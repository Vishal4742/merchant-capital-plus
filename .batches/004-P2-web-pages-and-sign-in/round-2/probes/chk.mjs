import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const b = await chromium.launch();
for (const scheme of ["light","dark"]) for (const w of [375,1440]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 800 }, colorScheme: scheme, hasTouch: w<500 });
  await ctx.route("**/api/v1/sessions/*/pay", (r) => r.abort("connectionreset"));
  const p = await ctx.newPage();
  await p.goto("http://localhost:3100/checkout/" + process.argv[2]); await p.waitForTimeout(1800);
  await p.getByRole("button", { name: /Hold to pay/ }).focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(1500);
  const bb = await p.getByRole("button", { name: "Check again" }).boundingBox();
  const c = await p.evaluate(() => { const pill=[...document.querySelectorAll('span')].find(e=>e.textContent==='Confirming'); const cs=getComputedStyle(pill); const bg=getComputedStyle(pill.closest('section')).backgroundColor; return {fg:cs.color,bg}; });
  console.log(scheme, w, "checkAgain box", Math.round(bb.width), Math.round(bb.height), JSON.stringify(c));
  await ctx.close();
}
await b.close();
