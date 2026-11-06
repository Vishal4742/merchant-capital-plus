// claude-frontend checks for lib/dither.ts (batch 002: the DitherScene maths). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { CELL, HORIZON, buildDots, sceneIntensity } from "../lib/dither.ts";

test("the scene is seeded: the same box always gives the same dots", () => {
  const a = buildDots(960, 600), b = buildDots(960, 600);
  assert.equal(a.count, b.count);
  assert.deepEqual(a.positions.slice(0, 300), b.positions.slice(0, 300));
});

test("dots stay inside the box and depth runs 0 to 1", () => {
  const d = buildDots(800, 500);
  assert.ok(d.count > 1000, `expected a visible picture, got ${d.count} dots`);
  for (let i = 0; i < d.count; i++) {
    const x = d.positions[3 * i], y = d.positions[3 * i + 1], z = d.positions[3 * i + 2];
    assert.ok(x >= 0 && x <= 800 && y >= 0 && y <= 500 + CELL, `dot ${i} at ${x},${y} is outside the box`);
    assert.ok(z >= 0 && z <= 1, `dot ${i} has depth ${z}`);
  }
  assert.equal(d.starts.length, 3 * d.count);
  assert.equal(d.brights.length, d.count);
});

test("the moon is lit and the night sky above it stays dark", () => {
  const W = 320, H = 200, I = sceneIntensity(W, H);
  const moon = I[Math.round(H * 0.18) * W + Math.round(W * 0.58)];
  const topCorner = I[2 * W + 2];
  assert.ok(moon > 0.9, `moon centre is ${moon}`);
  assert.ok(topCorner < 0.1, `top-left sky is ${topCorner}`);
});

test("the necklace of lamps sits on the water, below the horizon", () => {
  const W = 320, H = 200, I = sceneIntensity(W, H), hz = Math.round(H * HORIZON);
  let lampsBelow = 0, lampsAbove = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x += 2) {
      if (I[y * W + x] !== 1) continue;
      if (y >= hz) lampsBelow++;
      else lampsAbove++;
    }
  }
  assert.ok(lampsBelow > 50, `only ${lampsBelow} lamps on the water`);
  assert.equal(lampsAbove, 0);
});

test("a tiny or empty box doesn't throw", () => {
  assert.doesNotThrow(() => buildDots(0, 0));
  assert.doesNotThrow(() => buildDots(3, 3));
});

test("moonX moves the moon (the home hero lights it at 0.74, right of the headline)", () => {
  const W = 320, H = 200, my = Math.round(H * 0.18), I = sceneIntensity(W, H, 0.74);
  assert.ok(I[my * W + Math.round(W * 0.74)] > 0.9, "moon centre at 0.74 is lit");
  assert.ok(I[my * W + Math.round(W * 0.58)] < 0.9, "nothing left at the default spot");
  assert.deepEqual(sceneIntensity(W, H), sceneIntensity(W, H, 0.58), "the default stays 0.58");
});
