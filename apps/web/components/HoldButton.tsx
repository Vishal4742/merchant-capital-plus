"use client";

// Press and hold to confirm (human pick, 2026-11-05): a fill grows across the button while it is held;
// letting go early cancels; at the end it confirms. A keyboard press confirms at once, because holding
// a key is a poor accessibility pattern. Only the money-moving action uses this; every other button taps.
//
// One deliberate gesture = one confirm. Guards (security review, batch 002):
// - an auto-repeated key is ignored (holding Enter fires a trusted click per repeat in Chromium);
// - the phase lives in a ref, so a stale release or timer can never re-arm a confirm in flight;
// - only trusted events count: assistive tech and real input are trusted, element.click() from a script is not;
// - a hold whose label changes before it completes is cancelled, so it never confirms terms the user didn't see,
//   and leaving the window or tab mid-hold cancels it (security review R3 D2, D5).
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { flushSync } from "react-dom";

export const HOLD_MS = 900;
export const DONE_MS = 450;
// active:scale-[.97] pulls the edges in while pressed; a finger resting on the edge must not cancel (R3 #17)
const SLOP_PX = 12;

type Phase = "idle" | "holding" | "busy" | "done";

export interface HoldButtonProps {
  /** Idle label, e.g. "Hold to pay 25.00 USDT". */
  label: string;
  /** Runs once the hold completes (or on a keyboard press). Rejecting returns the button to idle. */
  onConfirm: () => Promise<unknown>;
  busyLabel?: string;
  doneLabel?: string;
  className?: string;
  "aria-describedby"?: string;
}

export function HoldButton({ label, onConfirm, busyLabel = "Confirming", doneLabel = "Done", className = "", ...aria }: HoldButtonProps) {
  const [phase, setPhaseState] = useState<Phase>("idle");
  const phaseRef = useRef<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // window/document listeners live only while a hold does: one controller per hold, aborted when it ends (code R1 LOW)
  const holdListeners = useRef<AbortController | null>(null);
  const shownLabel = useRef(label);
  useEffect(() => {
    shownLabel.current = label;
  }, [label]);
  // Only clear the timer on unmount. A "mounted" flag breaks under StrictMode's dev remount and left the
  // button stuck on busy (code review, batch 002); setting state after unmount is a harmless no-op.
  // A hidden <Activity> route runs this cleanup and later re-runs effects on the same state: drop a pending
  // "done" so the button comes back idle, but keep "busy" so a confirm in flight can't be re-armed (R3 D1).
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      holdListeners.current?.abort();
      if (phaseRef.current !== "busy") {
        phaseRef.current = "idle";
        setPhaseState("idle");
      }
    },
    [],
  );

  const setPhase = (next: Phase, sync = false) => {
    phaseRef.current = next;
    if (sync) flushSync(() => setPhaseState(next)); // paint "busy" even when onConfirm settles in the same task
    else setPhaseState(next);
  };

  const confirm = () => {
    holdListeners.current?.abort();
    if (phaseRef.current === "busy" || phaseRef.current === "done") return;
    setPhase("busy", true);
    onConfirm().then(
      () => {
        setPhase("done");
        timer.current = setTimeout(() => setPhase("idle"), DONE_MS);
      },
      () => setPhase("idle"),
    );
  };
  const startHold = (e: PointerEvent) => {
    if (!e.nativeEvent.isTrusted || e.button !== 0 || phaseRef.current !== "idle") return;
    setPhase("holding");
    const pressedLabel = label;
    timer.current = setTimeout(() => (shownLabel.current === pressedLabel ? confirm() : cancelHold()), HOLD_MS);
    holdListeners.current?.abort();
    const { signal } = (holdListeners.current = new AbortController());
    window.addEventListener("blur", cancelHold, { signal });
    document.addEventListener("visibilitychange", cancelHold, { signal });
  };
  // Touch keeps the pointer captured by the button, so pointerleave never fires: check the bounds instead.
  const cancelIfOutside = (e: PointerEvent<HTMLButtonElement>) => {
    if (phaseRef.current !== "holding") return;
    const r = e.currentTarget.getBoundingClientRect();
    const out = e.clientX < r.left - SLOP_PX || e.clientX > r.right + SLOP_PX || e.clientY < r.top - SLOP_PX || e.clientY > r.bottom + SLOP_PX;
    if (out) cancelHold();
  };
  const cancelHold = () => {
    holdListeners.current?.abort();
    if (phaseRef.current !== "holding") return;
    clearTimeout(timer.current);
    setPhase("idle");
  };

  const busy = phase === "busy" || phase === "done";
  return (
    <button
      type="button"
      aria-disabled={busy}
      aria-describedby={aria["aria-describedby"]}
      onPointerDown={startHold}
      onPointerUp={cancelHold}
      onPointerMove={cancelIfOutside}
      onPointerLeave={cancelHold}
      onPointerCancel={cancelHold}
      onKeyDown={(e) => e.repeat && e.preventDefault()}
      // detail === 0: a keyboard or assistive-tech activation, which confirms at once.
      onClick={(e) => e.detail === 0 && e.nativeEvent.isTrusted && phaseRef.current === "idle" && confirm()}
      onContextMenu={(e) => e.preventDefault()}
      className={
        "relative inline-flex h-12 touch-none select-none items-center justify-center gap-2 overflow-hidden rounded-pill px-6 text-base font-medium " +
        "transition-[background-color,box-shadow,transform] duration-300 ease-spring hover:-translate-y-px active:scale-[.97] " +
        (phase === "done" ? "bg-positive text-surface " : "bg-accent text-on-accent hover:bg-accent-hover hover:shadow-glow ") +
        (busy ? "cursor-progress " : "") +
        className
      }
    >
      <span
        aria-hidden="true"
        data-motion="essential"
        className="pointer-events-none absolute inset-0 origin-left bg-ink/20"
        style={{
          transform: `scaleX(${phase === "holding" ? 1 : 0})`,
          transition: phase === "holding" ? `transform ${HOLD_MS}ms linear` : "transform 300ms ease-out",
        }}
      />
      <span className="relative inline-flex items-center gap-2">
        {phase === "busy" && (
          <span className="inline-flex gap-[5px]" aria-hidden="true">
            {[0, 150, 300].map((delay) => (
              <i key={delay} className="size-1.5 rounded-full bg-current" style={{ animation: `dot-pulse 1s ${delay}ms infinite ease-in-out` }} />
            ))}
          </span>
        )}
        {phase === "busy" ? busyLabel : phase === "done" ? doneLabel : label}
      </span>
    </button>
  );
}
