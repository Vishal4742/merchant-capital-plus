import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const S = new URL("../shots/", import.meta.url).pathname;
const b = await chromium.launch();
for (const w of [375,1440]) for (const c of ["light","dark"]) {
  const ctx = await b.newContext({ viewport:{width:w,height:812}, colorScheme:c });
  const p = await ctx.newPage(); await p.goto("http://localhost:3100/merchant"); await p.waitForTimeout(3500);
  await p.screenshot({ path:`${S}merchant2-${w}-${c}.png`, fullPage:true });
  console.log(w,c,(await p.innerText("body")).replace(/\s+/g," "), await p.evaluate(()=>document.documentElement.scrollWidth-innerWidth), JSON.stringify(await p.getByRole("button").evaluateAll(bs=>bs.map(x=>[x.innerText,x.getBoundingClientRect().height]))));
  await ctx.close();
}
await b.close();
