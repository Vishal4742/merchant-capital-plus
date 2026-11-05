"use client";

// The night scene as one still 2D drawing: no three.js, no animation, a few KB of JS. Used where speed is a
// requirement (NFR-12: /checkout and receipts, LCP ≤ 2.0 s on a 4G phone), and as DitherScene's no-WebGL fallback.
import { useEffect, useRef } from "react";
import { CELL, buildDots, type Dots } from "@/lib/dither";

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function drawStatic(canvas: HTMLCanvasElement, dots: Dots, w: number, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = cssColor("--scene-night");
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = cssColor("--scene-dot");
  for (let i = 0; i < dots.count; i++) {
    ctx.fillRect(dots.positions[3 * i] - CELL / 2, dots.positions[3 * i + 1] - CELL / 2, CELL - 1, CELL - 1);
  }
}

/** Fills its positioned parent with the still scene; redraws on resize. Decorative (aria-hidden). */
export function StaticScene({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current, host = canvas?.parentElement;
    if (!canvas || !host) return;
    const draw = () => drawStatic(canvas, buildDots(host.clientWidth, host.clientHeight), host.clientWidth, host.clientHeight);
    // after first paint, so the sheet (the LCP element) never waits for the scene
    const raf = requestAnimationFrame(draw);
    let pending: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(pending);
      pending = setTimeout(draw, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(pending);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={ref} aria-hidden="true" className={className ?? "absolute inset-0 block h-full w-full"} />;
}
