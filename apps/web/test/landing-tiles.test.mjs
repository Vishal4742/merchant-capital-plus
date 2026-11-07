// claude-frontend batch 062: the landing's four Accept tiles show working examples (FR-GW-1..4): a real link with Copy,
// a real page, the real QR, the real button snippet. The demo link and page come from env. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { landingDemo } = await import("../lib/config.ts");

const withEnv = (env, fn) => {
  const names = ["DEMO_LINK_SLUG", "DEMO_PAGE_SLUG", "PUBLIC_ORIGIN"];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  for (const n of names) if (env[n] === undefined) delete process.env[n]; else process.env[n] = env[n];
  try { return fn(); } finally { for (const n of names) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
};

test("landingDemo: slugs and the site's origin from env", () => {
  const demo = withEnv({ DEMO_LINK_SLUG: "Ab3dEf7hJk", DEMO_PAGE_SLUG: "Zz9yXw8vUt", PUBLIC_ORIGIN: "https://whiteflow.org/" }, landingDemo);
  assert.deepEqual(demo, { origin: "https://whiteflow.org", link: "Ab3dEf7hJk", page: "Zz9yXw8vUt" });
});

test("landingDemo: unset or not a slug is null (no fake controls); no origin falls back to whiteflow.org", () => {
  assert.deepEqual(withEnv({}, landingDemo), { origin: "https://whiteflow.org", link: null, page: null });
  const bad = withEnv({ DEMO_LINK_SLUG: '"><script>', DEMO_PAGE_SLUG: "../admin" }, landingDemo);
  assert.deepEqual([bad.link, bad.page], [null, null]);
});

const accept = (() => {
  const s = readFileSync(new URL("../components/landing/Sections.tsx", import.meta.url), "utf8");
  const start = s.indexOf("export function Accept()");
  return s.slice(start, s.indexOf("\nexport function", start + 1));
})();

test("the tiles use the real pieces: CopyButton, /qr/l/<slug>, /p/<slug>, /v1/button.js with data-link", () => {
  assert.match(accept, /<CopyButton text=\{linkUrl\}/);
  assert.match(accept, /src=\{`\/qr\/l\/\$\{demo\.link\}`\}/);
  assert.match(accept, /href=\{`\/p\/\$\{demo\.page\}`\}/);
  assert.match(accept, /\/v1\/button\.js/);
  assert.match(accept, /data-link=/);
  assert.doesNotMatch(accept, /pay\.mc\//); // the made-up address is gone
  assert.doesNotMatch(accept, /<span className="copy" aria-hidden="true">/); // no Copy that does nothing
});
