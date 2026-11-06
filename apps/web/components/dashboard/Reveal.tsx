"use client";

// A KPI figure whose digits scramble into place once (approved gateway v2 design). The server renders the real figure,
// screen readers only ever get the real figure, and reduced motion keeps it still.
import { useEffect, useState } from "react";

const GLYPHS = "01#%*+=$@";
const REVEAL_MS = 700;

function scramble(text: string, progress: number): string {
  const settled = Math.floor(progress * text.length);
  return [...text].map((ch, i) => (i < settled || !/\d/.test(ch) ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join("");
}

export function Reveal({ text }: { text: string }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function step(now) {
      const progress = Math.min(1, (now - start) / REVEAL_MS);
      setShown(progress < 1 ? scramble(text, progress) : null);
      if (progress < 1) frame = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return (
    <>
      <span aria-hidden="true">{shown ?? text}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}
