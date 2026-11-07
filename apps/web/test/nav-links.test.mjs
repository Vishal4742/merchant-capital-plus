// claude-frontend batch 045: every dashboard menu item is a built screen, so every one is a link; Webhooks opens the
// webhooks section of the Developers screen (FR-GW-7). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const nav = readFileSync(new URL("../components/dashboard/Nav.tsx", import.meta.url), "utf8");
// batch 049: the Whiteflow destinations also carry an icon after the href
const items = [...nav.matchAll(/\{ key: "(\w+)", label: "[^"]+"(, href: "([^"]+)")?(, icon: "\w+")? \}/g)].map((m) => ({ key: m[1], href: m[3] }));

test("nav: every menu item has an href", () => {
  assert.ok(items.length >= 12, `found ${items.length} items`);
  assert.deepEqual(items.filter((i) => !i.href).map((i) => i.key), []);
});

test("nav: Webhooks opens the Developers screen's webhooks section, and nothing says Soon", () => {
  assert.equal(items.find((i) => i.key === "webhooks")?.href, "/merchant/developers#webhooks");
  assert.doesNotMatch(nav, /Soon/);
});
