"use client";
// The day/night switch (batch 060, FR-UX-4): one button that flips <html data-theme> and saves the choice; the root
// layout's pre-paint script (lib/theme.ts) applies it on every later load. With nothing saved, the device decides.
import { useSyncExternalStore } from "react";
import { THEME_KEY, type Theme } from "@/lib/theme";

const CHANGED = "mcplus:theme"; // this tab's own flips; the device's change comes from matchMedia
const DARK = "(prefers-color-scheme: dark)";

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(DARK);
  media.addEventListener("change", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    media.removeEventListener("change", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

const current = (): Theme => {
  const set = document.documentElement.dataset.theme;
  return set === "light" || set === "dark" ? set : window.matchMedia(DARK).matches ? "dark" : "light";
};

function choose(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private mode: the choice holds for this page only
  }
  window.dispatchEvent(new Event(CHANGED));
}

/** `className` sizes and colours it for its header (glass over the landing scene, plain on the dashboard). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, current, () => null); // null on the server: the device isn't known there
  const label = theme === "dark" ? "Switch to day mode" : "Switch to night mode";
  return (
    <button
      type="button"
      onClick={() => choose(theme === "dark" ? "light" : "dark")}
      aria-label={label}
      title={label}
      className={`inline-grid size-10 shrink-0 place-items-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {theme === "dark" ? (
          // a sun: you're in night mode, this brings the day
          <>
            <circle cx="12" cy="12" r="4.2" />
            <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6" />
          </>
        ) : (
          // a crescent moon: you're in day mode, this brings the night
          <path d="M20.2 14.6A8.5 8.5 0 0 1 9.4 3.8a8.5 8.5 0 1 0 10.8 10.8Z" />
        )}
      </svg>
    </button>
  );
}
