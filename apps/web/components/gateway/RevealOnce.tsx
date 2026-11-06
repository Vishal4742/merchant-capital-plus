"use client";

// A new API key or webhook signing secret, shown once (FR-GW-6, FR-GW-7): the value in the mono face with the shared
// CopyButton, and a plain "you won't see it again". It lives only in the screen's memory: never a URL, storage or a
// log, and the server never renders it, so no later page's RSC payload has it. It goes when the merchant presses
// "I've saved it", reloads or leaves (pagehide also clears it before a back/forward cache snapshot).
import { useEffect, useId, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";

// the gateway v2 spring (overshoot, then settle), written out as in globals.css .lift
const SPRING = "linear(0, .009, .035 2.1%, .141, .281 6.7%, .723 12.9%, .938 16.7%, 1.017, 1.077, 1.121, 1.149 24.3%, 1.159, 1.163, 1.161, 1.154 29.9%, 1.129 32.8%, 1.051 39.6%, 1.017 43.1%, .991, .977 51%, .974 53.8%, .975 57.1%, .997 69.8%, 1.003 76.9%, 1.004 83.8%, 1)";

export function RevealOnce({ title, value, noun, children, onDone }: { title: string; value: string; noun: "key" | "secret"; children?: ReactNode; onDone: () => void }) {
  const id = useId(); // the key and the secret panels can be open at once
  const heading = useRef<HTMLHeadingElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    heading.current?.focus(); // screen readers land on the panel; the value itself is never announced by a live region
    const clear = () => flushSync(() => done.current());
    window.addEventListener("pagehide", clear);
    return () => window.removeEventListener("pagehide", clear);
  }, []);
  return (
    <section
      aria-labelledby={id}
      className="grid min-w-0 gap-3 rounded-[16px] border border-accent bg-accent-soft p-4 starting:translate-y-2 starting:scale-[.98] starting:opacity-0"
      style={{ transition: `opacity 300ms ease, translate 700ms ${SPRING}, scale 700ms ${SPRING}` }}
    >
      <h3 id={id} ref={heading} tabIndex={-1} className="eyebrow text-accent outline-none">
        {title}
      </h3>
      <div className="flex min-w-0 items-center gap-2 rounded-[12px] border border-hairline bg-surface py-1 pr-1 pl-3">
        <code className="data min-w-0 flex-1 py-2 break-all select-all">{value}</code>
        <CopyButton text={value} name={`the new ${noun}`} />
      </div>
      <p className="text-sm font-medium">You won&apos;t see this {noun} again. Copy it now.</p>
      {children && <p className="text-sm text-ink-muted">{children}</p>}
      <Button variant="quiet" className="justify-self-start text-sm" onClick={onDone}>
        I&apos;ve saved it
      </Button>
    </section>
  );
}
