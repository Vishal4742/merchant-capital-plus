"use client";

// The poster's halftone "$" (gateway v2 design): the glyph is rasterised in the page's own sans, sampled into dots,
// and the dots assemble from scattered positions the first time the poster is a third on screen. Reduced motion
// draws it assembled.
import { useEffect, useRef } from "react";
import { mulberry32 } from "@/lib/dither";
import { afterPaint, cssVar, fit, onResize, prefersReducedMotion, visibleLoop, type Fitted } from "./canvas";

const CELL = 4;
const DOT_R = 1.7;
const ASSEMBLE_MS = 1800;

/** [x, y, startX, startY, delay] per dot */
type Pt = [number, number, number, number, number];

function sample({ w, h }: Fitted, family: string): Pt[] {
  const off = document.createElement("canvas");
  off.width = Math.round(w);
  off.height = Math.round(h);
  const o = off.getContext("2d", { willReadFrequently: true });
  if (!o) return [];
  o.font = `500 ${Math.round(h * 0.95)}px ${family}`;
  o.textAlign = "center";
  o.textBaseline = "middle";
  o.fillText("$", w / 2, h * 0.53);
  const px = o.getImageData(0, 0, off.width, off.height).data, r = mulberry32(3), pts: Pt[] = [];
  for (let y = 0; y < h; y += CELL) {
    for (let x = 0; x < w; x += CELL) {
      const a = px[((y | 0) * off.width + (x | 0)) * 4 + 3] / 255, edge = Math.hypot(x - w / 2, y - h / 2) / (w * 0.7);
      const v = a > 0.5 ? 0.85 - edge * 0.5 : 0.06 * (1 - edge);
      if (r() < v) pts.push([x + CELL / 2, y + CELL / 2, r() * w, r() * h, r() * 0.35]);
    }
  }
  return pts;
}

function draw({ ctx, w, h }: Fitted, pts: Pt[], k: number, color: string) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.beginPath(); // one path for every dot: same picture, one fill call
  for (const [x, y, sx, sy, delay] of pts) {
    const p = Math.max(0, Math.min(1, (k - delay) / 0.65)), e = 1 - Math.pow(1 - p, 4);
    const cx = sx + (x - sx) * e, cy = sy + (y - sy) * e;
    ctx.moveTo(cx + DOT_R, cy);
    ctx.arc(cx, cy, DOT_R, 0, Math.PI * 2);
  }
  ctx.fill();
}

export function Glyph() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const reduce = prefersReducedMotion(), color = cssVar("--scene-dot"), family = cssVar("--font-sans");
    let fitted: Fitted | null = null, pts: Pt[] = [], t0 = 0, done = false, disposed = false;

    const prepare = () => {
      fitted = fit(canvas);
      pts = fitted ? sample(fitted, family) : [];
    };
    const loop = visibleLoop(canvas, (now) => {
      if (!fitted) return false;
      if (!t0) t0 = now;
      const k = reduce || done ? 1 : Math.min(1, (now - t0) / ASSEMBLE_MS);
      draw(fitted, pts, k, color);
      done = k >= 1;
      return !done;
    }, 0.35);
    // the glyph needs the real font, or it samples the fallback's "$"
    const cancelIdle = afterPaint(() => {
      document.fonts.load(`500 100px ${family}`).catch(() => undefined).then(() => {
        if (disposed) return;
        prepare();
        loop.kick();
      });
    });
    const stopResize = onResize(canvas, () => {
      prepare();
      if (done && fitted) draw(fitted, pts, 1, color);
    });
    return () => {
      disposed = true;
      cancelIdle();
      stopResize();
      loop.stop();
    };
  }, []);

  return <canvas ref={ref} className="lp-glyph" aria-hidden="true" />;
}
