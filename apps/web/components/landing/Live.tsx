"use client";

// Small live bits of the home page: the quote card's 10:00 lock countdown, and numbers that
// scramble into place (ASCII reveal) the first time they scroll into view.
import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/dashboard/Reveal";

const LOCK_SECONDS = 600;

const everySecond = (tick: () => void) => {
  const id = setInterval(tick, 1000);
  return () => clearInterval(id);
};
/** The FX quote's lock: counts down from 10:00 and stops at 00:00. */
export function LockTimer() {
  const [left, setLeft] = useState(LOCK_SECONDS);
  useEffect(() => everySecond(() => setLeft((s) => Math.max(0, s - 1))), []);
  const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
  return (
    <span className="num mono" role="timer" aria-label={`Quote locked for ${Number(mm)} min ${Number(ss)} s`}>
      {mm}:{ss}
    </span>
  );
}

/** The real figure until it is on screen, then the dashboard's scramble-into-place reveal, once. */
export function RevealOnView({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setSeen(true);
      io.disconnect();
    }, { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <span ref={ref}>{seen ? <Reveal text={text} /> : text}</span>;
}
