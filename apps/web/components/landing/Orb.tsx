"use client";

// The settle band's one lit subject (gateway v2 design): a sphere, Bayer-dithered, with a dithered specular highlight.
// Its light drifts slowly (about 20 fps) only while the band is on screen; reduced motion gets one still frame.
import { useEffect, useRef } from "react";
import { BAYER } from "@/lib/dither";
import { afterPaint, cssVar, fit, onResize, prefersReducedMotion, visibleLoop, type Fitted } from "./canvas";

const CELL = 3;
const FRAME_MS = 50;
const DRIFT = 0.012;
const SPECULAR = "#dfe3ff"; // the highlight's near-white blue, from the design (no token: only this scene uses it)

function draw({ ctx, w, h }: Fitted, a: number, dot: string) {
  const W = Math.ceil(w / CELL), H = Math.ceil(h / CELL), R = Math.min(W, H) * 0.42, cx = W / 2, cy = H / 2;
  const lx = -0.5 + 0.18 * Math.sin(a), ly = -0.55 + 0.12 * Math.cos(a * 0.8), lz = Math.sqrt(Math.max(0.1, 1 - lx * lx - ly * ly));
  ctx.clearRect(0, 0, w, h);
  let fill = "";
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x - cx) / R, dy = (y - cy) / R, d = dx * dx + dy * dy;
      let v: number, hi = 0;
      if (d <= 1) {
        const nz = Math.sqrt(1 - d), lam = Math.max(0, lx * dx + ly * dy + lz * nz);
        v = 0.05 + 0.85 * Math.pow(lam, 1.5);
        hi = Math.pow(Math.max(0, 0.9 * lx * dx + 0.9 * ly * dy + nz), 18);
      } else v = 0.22 * Math.exp(-(Math.sqrt(d) - 1) * 6);
      if (v * 16 <= BAYER[(y & 3) * 4 + (x & 3)] + 0.5) continue;
      const next = hi * 16 > BAYER[((y + 2) & 3) * 4 + ((x + 1) & 3)] + 0.5 ? SPECULAR : dot;
      if (next !== fill) ctx.fillStyle = fill = next;
      ctx.fillRect(x * CELL, y * CELL, CELL - 1, CELL - 1);
    }
  }
}

export function Orb() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = prefersReducedMotion(), dot = cssVar("--scene-dot");
    let fitted: Fitted | null = null, angle = 0, last = 0;

    const loop = visibleLoop(canvas, (now) => {
      if (!fitted) return false;
      if (reduce) {
        draw(fitted, angle, dot);
        return false;
      }
      if (now - last > FRAME_MS) {
        last = now;
        angle += DRIFT;
        draw(fitted, angle, dot);
      }
      return true;
    });
    const cancelIdle = afterPaint(() => {
      fitted = fit(canvas);
      loop.kick();
    });
    const stopResize = onResize(canvas, () => {
      fitted = fit(canvas);
      last = 0;
      loop.kick();
    });
    return () => {
      cancelIdle();
      stopResize();
      loop.stop();
    };
  }, []);

  return <canvas ref={ref} className="lp-orb" aria-hidden="true" />;
}
