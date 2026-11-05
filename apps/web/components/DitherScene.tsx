"use client";

// The night scene: Marine Drive dithered into blue dots, drawn as GPU points with three.js.
// Dots gather from scattered positions, sit on depth layers that drift with the cursor, part around
// the cursor, and lamps twinkle. Without WebGL it draws the same dots once on a 2D canvas.
import { useEffect, useRef } from "react";
import { CELL, buildDots, type Dots } from "@/lib/dither";

const GATHER_MS = 1800;
const PUSH_RADIUS = 120;
const PUSH_PX = 26;
const PARALLAX_PX = 14;

const vertexShader = /* glsl */ `
  uniform float uProgress, uTime, uW, uMouseK, uPush, uRadius, uSize;
  uniform vec2 uMouse, uParallax;
  attribute vec3 aStart; attribute float aSeed; attribute float aBright;
  varying float vAlpha;
  void main() {
    vec2 target = position.xy;
    float p = clamp(uProgress * 1.6 - (target.x / uW) * 0.6, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - p, 3.0);
    vec2 pos = mix(aStart.xy, target, e) + uParallax * position.z;
    vec2 d = pos - uMouse; float dist = length(d);
    if (dist < uRadius && dist > 0.001) pos += d / dist * pow(1.0 - dist / uRadius, 2.0) * uPush * uMouseK;
    // lamps (1.0) and lit windows (0.85) twinkle; the moon (0.97) only shimmers
    float lamp = step(0.98, aBright) + step(0.8, aBright) * step(aBright, 0.9);
    float twinkle = lamp > 0.0 ? 0.65 + 0.35 * sin(uTime * 1.8 + aSeed * 50.0)
                  : aBright > 0.9 ? 0.9 + 0.1 * sin(uTime * 0.6 + aSeed * 6.0) : 1.0;
    vAlpha = twinkle * smoothstep(0.0, 0.35, e + 0.1);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
    gl_PointSize = uSize * (1.0 + 0.8 * (1.0 - e));
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor; varying float vAlpha;
  void main() {
    gl_FragColor = vec4(uColor, vAlpha);
    #include <colorspace_fragment> // uColor is linear; convert so dots match the --scene-dot token
  }`;

function cssColor(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawStatic(canvas: HTMLCanvasElement, dots: Dots, w: number, h: number) {
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

interface DitherSceneProps {
  className?: string;
}

/** Fills its positioned parent. The parent receives the pointer, so content on top stays clickable. */
export function DitherScene({ className }: DitherSceneProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cleanup = () => {};
    let cancelled = false;

    import("three")
      .then((THREE) => {
        if (cancelled) return;
        const drawFallback = () => drawStatic(canvas, buildDots(host.clientWidth, host.clientHeight), host.clientWidth, host.clientHeight);
        const context = canvas.getContext("webgl2", { antialias: false });
        if (!context) {
          drawFallback();
          window.addEventListener("resize", drawFallback);
          cleanup = () => window.removeEventListener("resize", drawFallback);
          return;
        }
        const renderer = new THREE.WebGLRenderer({ canvas, context });
        renderer.setClearColor(new THREE.Color(cssColor("--scene-night")));
        const scene = new THREE.Scene();
        const camera = new THREE.OrthographicCamera(0, 1, 0, 1, -10, 10); // pixel space, y down
        const uniforms = {
          uProgress: { value: reduce ? 1 : 0 },
          uTime: { value: 0 },
          uW: { value: 1 },
          uMouse: { value: new THREE.Vector2(-9999, -9999) },
          uMouseK: { value: 0 },
          uPush: { value: PUSH_PX },
          uRadius: { value: PUSH_RADIUS },
          uParallax: { value: new THREE.Vector2(0, 0) },
          uSize: { value: CELL },
          uColor: { value: new THREE.Color(cssColor("--scene-dot")) },
        };
        const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthTest: false });
        let points: import("three").Points | null = null;

        const layout = () => {
          const w = host.clientWidth, h = host.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
          renderer.setPixelRatio(dpr);
          renderer.setSize(w, h, false);
          camera.right = w;
          camera.bottom = h;
          camera.updateProjectionMatrix();
          uniforms.uW.value = w;
          uniforms.uSize.value = (CELL - 0.6) * dpr;
          const dots = buildDots(w, h);
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(dots.positions, 3));
          geometry.setAttribute("aStart", new THREE.BufferAttribute(dots.starts, 3));
          geometry.setAttribute("aSeed", new THREE.BufferAttribute(dots.seeds, 1));
          geometry.setAttribute("aBright", new THREE.BufferAttribute(dots.brights, 1));
          if (points) {
            scene.remove(points);
            points.geometry.dispose();
          }
          points = new THREE.Points(geometry, material);
          scene.add(points);
        };
        layout();

        const mouse = { x: -9999, y: -9999, k: 0, target: 0, px: 0, py: 0 };
        const onMove = (e: PointerEvent) => {
          const rc = canvas.getBoundingClientRect();
          mouse.x = e.clientX - rc.left;
          mouse.y = e.clientY - rc.top;
          mouse.target = 1;
          mouse.px = (mouse.x / rc.width - 0.5) * -2;
          mouse.py = (mouse.y / rc.height - 0.5) * -2;
        };
        const onLeave = () => Object.assign(mouse, { target: 0, px: 0, py: 0 });
        host.addEventListener("pointermove", onMove);
        host.addEventListener("pointerleave", onLeave);

        let visible = true;
        const observer = new IntersectionObserver(([entry]) => {
          visible = entry.isIntersecting;
        });
        observer.observe(host);
        const t0 = performance.now();
        // Reduced motion: one still frame (and one per resize), no loop, no twinkle.
        if (reduce) renderer.render(scene, camera);
        else renderer.setAnimationLoop((now) => {
          if (!visible) return;
          const t = now - t0;
          uniforms.uTime.value = t / 1000;
          uniforms.uProgress.value = Math.min(1, t / GATHER_MS);
          mouse.k += (mouse.target - mouse.k) * 0.1;
          uniforms.uMouseK.value = mouse.k;
          uniforms.uMouse.value.set(mouse.x, mouse.y);
          const par = uniforms.uParallax.value;
          par.set(par.x + (mouse.px * PARALLAX_PX - par.x) * 0.06, par.y + (mouse.py * PARALLAX_PX - par.y) * 0.06);
          renderer.render(scene, camera);
        });

        let pending: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
          clearTimeout(pending);
          pending = setTimeout(() => {
            layout();
            if (reduce) renderer.render(scene, camera);
          }, 150);
        };
        window.addEventListener("resize", onResize);

        cleanup = () => {
          clearTimeout(pending);
          window.removeEventListener("resize", onResize);
          host.removeEventListener("pointermove", onMove);
          host.removeEventListener("pointerleave", onLeave);
          observer.disconnect();
          renderer.setAnimationLoop(null);
          points?.geometry.dispose();
          material.dispose();
          renderer.dispose();
          renderer.forceContextLoss(); // free the GPU context; browsers cap live contexts at about 16
        };
      })
      .catch(() => {
        // three.js failed to load: show the still scene rather than an empty night.
        if (!cancelled) drawStatic(canvas, buildDots(host.clientWidth, host.clientHeight), host.clientWidth, host.clientHeight);
      });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className ?? "absolute inset-0 block h-full w-full"} />;
}
