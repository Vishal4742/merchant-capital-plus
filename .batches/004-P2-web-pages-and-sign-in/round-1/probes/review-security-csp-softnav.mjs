// Probe: is the /checkout CSP in force when the checkout is reached by "Try a checkout" on / (soft navigation)?
// Creates one demo session on the local next start (:3100). Signs nothing, pays nothing.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("/Users/vg890/.npm/_npx/e41f203b7505f1fb/node_modules/playwright");

const BASE = "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser.newPage();

// does the current document enforce img-src 'self'? (a cross-origin image fires securitypolicyviolation if so)
const cspProbe = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let violated = false;
        const onV = () => (violated = true);
        document.addEventListener("securitypolicyviolation", onV);
        const img = new Image();
        img.src = "https://example.invalid/csp-probe.png";
        setTimeout(() => {
          document.removeEventListener("securitypolicyviolation", onV);
          resolve({ violated, documentLoadedFrom: performance.getEntriesByType("navigation")[0]?.name, location: location.pathname });
        }, 1500);
      }),
  );

await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Try a checkout" }).click();
await page.waitForURL(/\/checkout\//, { timeout: 20_000 });
await page.getByText("Hold to pay", { exact: false }).first().waitFor({ timeout: 20_000 });
const soft = await cspProbe();
const checkoutUrl = page.url();

await page.goto(checkoutUrl, { waitUntil: "networkidle" }); // hard load of the same checkout
const hard = await cspProbe();

console.log(JSON.stringify({ softNavigation: soft, hardLoad: hard }, null, 1).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, "<id>"));
await browser.close();
