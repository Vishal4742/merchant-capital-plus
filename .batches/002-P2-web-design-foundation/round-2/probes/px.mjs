import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");
const b = await chromium.launch(); const p = await b.newPage();
for (const f of process.argv.slice(2)) {
  const r = await p.evaluate(async (s) => {
    const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
    const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext("2d"); x.drawImage(bm, 0, 0);
    const d = x.getImageData(0, 0, bm.width, 430).data; const m = new Map();
    for (let i = 0; i < d.length; i += 4) { if (d[i + 2] > d[i] + 60) { const k = `${d[i]},${d[i + 1]},${d[i + 2]}`; m.set(k, (m.get(k) ?? 0) + 1); } }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  }, readFileSync(f).toString("base64"));
  console.log(f.split("/").pop(), JSON.stringify(r));
}
await b.close();
