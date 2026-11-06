"use client";

// The phone-width menu. A client navigation keeps the screen you left (React Activity, Next's preserved routes), so the
// menu you opened to leave it would still be open when you came back: it folds itself when its screen is hidden.
import { useLayoutEffect, useRef, type ReactNode } from "react";

export function FoldedMenu({ className, children }: { className: string; children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const details = menu.current;
    return () => {
      if (details) details.open = false;
    };
  }, []);
  return (
    <details ref={menu} className={className}>
      {children}
    </details>
  );
}
