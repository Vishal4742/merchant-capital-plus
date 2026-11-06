// Pure scene maths for DitherScene: Marine Drive at night as an intensity map, dithered into dots.
// No DOM, no three.js, so it runs in node:test as well as the browser.

export const CELL = 3; // px per dither cell
/** 4×4 ordered-dither thresholds (0–15): a cell is lit when brightness × 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5. */
export const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Small seeded PRNG so the scene draws the same every time. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Horizon row as a share of the height; the sea is below it. */
export const HORIZON = 0.6;

/** Brightness 0–1 per cell: sky glow, moon, skyline with lit windows, the Queen's Necklace of lamps, the sea and the moon's reflection.
 *  moonX: the moon's position as a share of the width (the home hero puts it at 0.74, right of the headline). */
export function sceneIntensity(W: number, H: number, moonX = 0.58): Float32Array {
  const I = new Float32Array(W * H);
  const r = mulberry32(1874);
  const hz = Math.round(H * HORIZON);
  const mx = W * moonX, my = H * 0.18, mr = Math.min(H * 0.075, W * 0.05);
  const roof = new Int16Array(W).fill(hz);
  for (let bx = 0; bx < W; ) {
    const w = 3 + Math.floor(r() * 9), h = Math.floor(H * (0.02 + r() * r() * 0.16));
    for (let i = bx; i < Math.min(W, bx + w); i++) roof[i] = hz - h;
    bx += w + (r() < 0.3 ? 1 : 0);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let v: number;
      if (y < hz) {
        const d = Math.hypot(x - mx, y - my);
        v = d < mr ? 0.97 : 0.03 + 0.3 * Math.pow(y / hz, 2.4) + 0.42 * Math.exp(-Math.pow((d - mr) / (H * 0.08), 2));
        if (y >= roof[x]) v = r() < 0.06 ? 0.85 : 0.02;
      } else {
        const t = (y - hz) / (H - hz), span = mr * (1.1 + 1.8 * t), rx = Math.abs(x - mx);
        v = 0.09 - 0.06 * t;
        if (rx < span && y % 2 === 0) v += 0.55 * (1 - t) * (1 - rx / span);
      }
      I[y * W + x] = Math.max(0, Math.min(1, v));
    }
  }
  for (let lx = 0; lx < W; lx += 2) {
    const ly = Math.round(hz + (H - hz) * 0.9 * Math.pow(1 - lx / W, 1.8));
    if (ly >= hz && ly < H) {
      I[ly * W + lx] = 1;
      if (ly + 1 < H) I[(ly + 1) * W + lx] = 0.7;
    }
  }
  return I;
}

export interface Dots {
  count: number;
  /** x, y in px and a depth 0 (far sky) … 1 (near water), 3 per dot */
  positions: Float32Array;
  /** scattered start x, y, 0, 3 per dot (where the gather begins) */
  starts: Float32Array;
  seeds: Float32Array;
  brights: Float32Array;
}

/** Dither the scene for a w × h px box with a 4×4 Bayer matrix. */
export function buildDots(w: number, h: number, cell = CELL): Dots {
  const W = Math.max(1, Math.ceil(w / cell)), H = Math.max(1, Math.ceil(h / cell));
  const I = sceneIntensity(W, H), hz = Math.round(H * HORIZON), r = mulberry32(7);
  const pos: number[] = [], start: number[] = [], seed: number[] = [], bright: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = I[y * W + x];
      if (v * 16 <= BAYER[(y & 3) * 4 + (x & 3)] + 0.5) continue;
      const depth = y < hz ? 0.12 + 0.38 * (y / hz) : 0.55 + 0.45 * ((y - hz) / Math.max(1, H - hz));
      pos.push(x * cell + cell / 2, y * cell + cell / 2, depth);
      start.push(w / 2 + (r() - 0.5) * w * 1.5, h / 2 + (r() - 0.5) * h * 1.5, 0);
      seed.push(r());
      bright.push(v);
    }
  }
  return {
    count: bright.length,
    positions: Float32Array.from(pos),
    starts: Float32Array.from(start),
    seeds: Float32Array.from(seed),
    brights: Float32Array.from(bright),
  };
}
