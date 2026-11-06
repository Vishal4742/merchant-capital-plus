"use client";

// Copies a snippet (the /docs code blocks). Clipboard missing (a page served over plain http on a LAN address) or
// blocked: the text is shown in a prompt to copy by hand (code review 006 L13).
import { useState } from "react";
import { Button } from "@/components/Button";

/** `name` says what is copied, so each button has its own accessible name ("Copy the server snippet"), and the
 *  "Copied" is announced from a live region beside the button (UX review 006 F4). `label` is the visible word; keep it
 *  inside "Copy {name}" so the accessible name holds what is seen. */
export function CopyButton({ text, name, label = "Copy" }: { text: string; name: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    (navigator.clipboard?.writeText(text) ?? Promise.reject(new Error("no clipboard"))).then(
      () => setCopied(true),
      () => window.prompt("Copy this:", text),
    );
  return (
    <>
      <Button variant="quiet" className="text-sm" onClick={copy} aria-label={`Copy ${name}`}>
        {copied ? "Copied" : label}
      </Button>
      <span role="status" className="sr-only">
        {copied ? `Copied ${name}` : ""}
      </span>
    </>
  );
}
