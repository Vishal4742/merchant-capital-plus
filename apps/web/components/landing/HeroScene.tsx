"use client";

// The hero's Marine Drive night (gateway v2 design): the scene's intensity map, Bayer 4×4 dithered into blue dots on a
// plain 2D canvas. The dots gather from scattered positions, left to right, then part around the cursor and spring
// back. Starts after first paint, draws only while on screen and the tab is visible; reduced motion gets a still frame.
import { useEffect, useRef } from "react";
import { BAYER, mulberry32, sceneIntensity } from "@/lib/dither";
import { afterPaint, cssVar, fit, onResize, prefersReducedMotion, visibleLoop } from "./canvas";

const CELL = 3;
const MOON_X = 0.74;
const GATHER_MS = 1600;
const PUSH_R = 96;
const PUSH_PX = 26;
const DOT_PX = 2;

interface Scene {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  n: number;
  px: Float32Array;
  py: Float32Array;
  sx: Float32Array;
  sy: Float32Array;
  t0: number;
  animate: boolean;
}

function build(canvas: HTMLCanvasElement, animate: boolean, t0 = performance.now()): Scene | null {
  const fitted = fit(canvas);
  if (!fitted) return null;
  const { ctx, w, h } = fitted;
  const W = Math.ceil(w / CELL), H = Math.ceil(h / CELL), I = sceneIntensity(W, H, MOON_X);
  const xs: number[] = [], ys: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (I[y * W + x] * 16 > BAYER[(y & 3) * 4 + (x & 3)] + 0.5) {
        xs.push(x * CELL);
        ys.push(y * CELL);
      }
    }
  }
  const r = mulberry32(9), n = xs.length, sx = new Float32Array(n), sy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sx[i] = r() * w;
    sy[i] = r() * h;
  }
  return { ctx, w, h, n, px: Float32Array.from(xs), py: Float32Array.from(ys), sx, sy, t0, animate };
}

export function HeroScene() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const reduce = prefersReducedMotion();
    const night = cssVar("--scene-night"), dot = cssVar("--scene-dot");
    const mouse = { x: -1e4, y: -1e4, k: 0, target: 0, moved: false };
    let scene: Scene | null = null;

    const frame = (now: number): boolean => {
      const s = scene;
      if (!s) return false;
      const t = s.animate ? Math.min(1, (now - s.t0) / GATHER_MS) : 1, { ctx } = s;
      mouse.k += (mouse.target - mouse.k) * 0.12;
      ctx.fillStyle = night;
      ctx.fillRect(0, 0, s.w, s.h);
      ctx.fillStyle = dot;
      const mk = reduce ? 0 : mouse.k, R2 = PUSH_R * PUSH_R;
      for (let j = 0; j < s.n; j++) {
        const tx = s.px[j], ty = s.py[j];
        const p = Math.max(0, Math.min(1, t * 1.6 - (tx / s.w) * 0.6)), e = 1 - Math.pow(1 - p, 3);
        let x = s.sx[j] + (tx - s.sx[j]) * e, y = s.sy[j] + (ty - s.sy[j]) * e;
        if (mk > 0.01) {
          const dx = x - mouse.x, dy = y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < R2 && d2 > 0.01) {
            const d = Math.sqrt(d2), f = Math.pow(1 - d / PUSH_R, 2) * PUSH_PX * mk;
            x += (dx / d) * f;
            y += (dy / d) * f;
          }
        }
        ctx.fillRect(x, y, DOT_PX, DOT_PX);
      }
      // keep drawing while gathering, while the parting eases in or out, and while the pointer moves
      const moved = mouse.moved;
      mouse.moved = false;
      return t < 1 || Math.abs(mouse.target - mouse.k) > 0.005 || moved;
    };

    const loop = visibleLoop(host, frame);
    const onMove = (e: PointerEvent) => {
      const rc = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rc.left;
      mouse.y = e.clientY - rc.top;
      mouse.target = 1;
      mouse.moved = true;
      loop.kick();
    };
    const onLeave = () => {
      mouse.target = 0;
      loop.kick();
    };
    if (!reduce) {
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", onLeave);
    }

    const cancelIdle = afterPaint(() => {
      scene = build(canvas, !reduce);
      loop.kick();
    });
    // a resize mid-gather (fonts settling on a phone) keeps the gather's clock, so it doesn't jump to the end
    const stopResize = onResize(host, () => {
      scene = scene ? build(canvas, scene.animate, scene.t0) : build(canvas, false);
      loop.kick();
    });

    return () => {
      cancelIdle();
      stopResize();
      loop.stop();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" />;
}
