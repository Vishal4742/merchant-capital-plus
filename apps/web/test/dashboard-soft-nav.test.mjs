// batch 044 (NFR-13): dashboard screens switch by client navigation only where the target sends the byte-identical
// Content-Security-Policy a full load would send, so a soft navigation never runs a screen under another route's policy
// (security review 005 F-N4). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { SOFT_NAV_SCREENS, softNav } from "../lib/soft-nav.ts";

const { match } = createRequire(import.meta.url)("next/dist/compiled/path-to-regexp"); // the matcher Next uses for headers()
const { default: config } = await import("../next.config.ts");
const rules = await config.headers();
/** The CSP a full load of `path` gets: for one header the last matching rule wins (Next docs, headers). */
const cspFor = (path) =>
  rules.filter((r) => match(r.source)(path)).flatMap((r) => r.headers.filter((h) => h.key === "Content-Security-Policy").map((h) => h.value)).at(-1);

test("soft nav: every soft-navigation screen gets the byte-identical /merchant policy", () => {
  const merchant = cspFor("/merchant");
  assert.ok(merchant, "/merchant sends no CSP");
  assert.ok(SOFT_NAV_SCREENS.length >= 7);
  for (const path of SOFT_NAV_SCREENS) assert.equal(cspFor(path), merchant, `${path} would run under another policy after a soft navigation`);
});

test("soft nav: Pages, API keys and Docs send another policy, so they stay full loads both ways", () => {
  for (const path of ["/merchant/pages", "/merchant/developers", "/docs", "/", "/proofs"]) {
    assert.notEqual(cspFor(path), cspFor("/merchant"), `${path} unexpectedly shares the /merchant policy`);
    assert.equal(softNav("/merchant/payments", path), false, `soft into ${path}`);
    assert.equal(softNav(path, "/merchant/payments"), false, `soft out of ${path}`);
  }
});

test("soft nav: the hash link to Home's invoices is soft from a same-policy screen", () => {
  assert.equal(softNav("/merchant/links", "/merchant#invoices"), true);
  assert.equal(softNav("/merchant/developers", "/merchant#invoices"), false);
});

test("soft nav: Nav renders next/link only through softNav, a plain <a> otherwise", () => {
  const nav = readFileSync(new URL("../components/dashboard/Nav.tsx", import.meta.url), "utf8");
  assert.match(nav, /import Link from "next\/link"/);
  assert.match(nav, /softNav\(/);
  assert.match(nav, /<a\b/); // the full-load path is still there
});
