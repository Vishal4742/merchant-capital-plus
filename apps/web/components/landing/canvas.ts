// Shared plumbing for the home page's 2D canvas scenes (hero, orb, poster): size to the CSS box, wait for first
// paint, and run frames only while the canvas is on screen and the tab is visible.

export interface Fitted {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
}

/** Match the backing store to the CSS box (DPR capped at 2) and draw in CSS pixels. */
export function fit(canvas: HTMLCanvasElement): Fitted | null {
  const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx || r.width === 0 || r.height === 0) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: r.width, h: r.height };
}

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Run after the browser is idle (first paint is long done), so the scenes never compete with the page. */
export function afterPaint(fn: () => void): () => void {
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(fn, { timeout: 1000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 60);
  return () => clearTimeout(id);
}

export interface Loop {
  /** Start frames again (after input, or when there is something new to draw). */
  kick: () => void;
  stop: () => void;
}

/**
 * rAF loop that only runs while `el` is at least `threshold` on screen and the tab is visible.
 * `frame` returns true to ask for another frame; once it returns false the loop sleeps until the next kick.
 */
export function visibleLoop(el: Element, frame: (now: number) => boolean, threshold = 0): Loop {
  let raf = 0, running = false, onScreen = false;
  const tick = (now: number) => {
    if (!onScreen || document.hidden || !frame(now)) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  const kick = () => {
    if (running || !onScreen || document.hidden) return;
    running = true;
    raf = requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(([entry]) => {
    // the first report fires at any overlap, so check the ratio too
    onScreen = entry.isIntersecting && entry.intersectionRatio >= threshold;
    kick();
  }, { threshold });
  io.observe(el);
  document.addEventListener("visibilitychange", kick);
  return {
    kick,
    stop: () => {
      cancelAnimationFrame(raf);
      running = false;
      io.disconnect();
      document.removeEventListener("visibilitychange", kick);
    },
  };
}

/** Redraw (debounced) when the element's box changes size. */
export function onResize(el: Element, fn: () => void, ms = 200): () => void {
  let pending: ReturnType<typeof setTimeout> | undefined, first = true;
  const ro = new ResizeObserver(() => {
    if (first) return void (first = false); // the observer reports the initial size once; that is not a resize
    clearTimeout(pending);
    pending = setTimeout(fn, ms);
  });
  ro.observe(el);
  return () => {
    clearTimeout(pending);
    ro.disconnect();
  };
}
