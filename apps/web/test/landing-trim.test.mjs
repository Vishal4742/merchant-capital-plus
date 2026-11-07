// claude-frontend batch 061: the human asked to remove the hero's corner labels and the rates ticker (FR-GW-11: the
// ticker's fixed rates disagreed with the checkout's). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("home: no hero corners, no IST clock, no rates ticker", () => {
  const hero = src("components/landing/Hero.tsx");
  for (const gone of ["72.82° E", "Marine Drive, Mumbai", "Fig. 01", "IstClock", "lp-corner", "Ticker", "display and quote only"]) {
    assert.ok(!hero.includes(gone), `Hero.tsx still has ${gone}`);
  }
  assert.doesNotMatch(src("app/page.tsx"), /Ticker/);
  assert.doesNotMatch(src("components/landing/Live.tsx"), /IstClock/);
  assert.doesNotMatch(src("components/landing/landing.css"), /lp-corner|lp-ticker/);
});
