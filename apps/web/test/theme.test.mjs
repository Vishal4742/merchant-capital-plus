// claude-frontend batch 060: the day/night switch (FR-UX-4). The pre-paint script applies a saved choice before first
// paint (no flash, NFR-12/13); with nothing saved the tokens follow the device. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { THEME_KEY, THEME_SCRIPT } = await import("../lib/theme.ts");

/** Runs the inline script against a fake <html> and storage, as the browser would before first paint. */
function prePaint(storage) {
  const html = { dataset: {} };
  new Function("localStorage", "document", THEME_SCRIPT)(storage, { documentElement: html });
  return html.dataset.theme;
}
const stored = (value) => ({ getItem: (key) => (key === THEME_KEY ? value : null) });

test("pre-paint: a saved day or night choice is applied", () => {
  assert.equal(prePaint(stored("dark")), "dark");
  assert.equal(prePaint(stored("light")), "light");
});

test("pre-paint: nothing saved or a bad value leaves the device's choice; blocked storage breaks nothing", () => {
  assert.equal(prePaint(stored(null)), undefined);
  assert.equal(prePaint(stored("purple")), undefined);
  assert.equal(prePaint(stored('"><script>')), undefined);
  assert.equal(prePaint({ getItem: () => { throw new Error("SecurityError"); } }), undefined);
});

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the root layout runs the script in <head> and expects <html> to differ from the server render", () => {
  const layout = src("app/layout.tsx");
  assert.match(layout, /<head>\s*<script dangerouslySetInnerHTML=\{\{ __html: THEME_SCRIPT \}\} \/>\s*<\/head>/);
  assert.match(layout, /<html[^>]*suppressHydrationWarning/);
});

test("the switch is labelled for both directions and saved under the key the script reads", () => {
  const toggle = src("components/ThemeToggle.tsx");
  assert.match(toggle, /"Switch to day mode"/);
  assert.match(toggle, /"Switch to night mode"/);
  assert.match(toggle, /localStorage\.setItem\(THEME_KEY/);
});

test("the landing, the dashboard (both frames), the docs and the investor pages show the switch", () => {
  for (const path of ["components/landing/Hero.tsx", "components/dashboard/Shell.tsx", "components/gateway/Frame.tsx", "app/docs/page.tsx", "components/capital/investor/InvestorApp.tsx"]) {
    assert.match(src(path), /<ThemeToggle\b/, path);
  }
});
