// A missing checkout or receipt, on the same night scene and sheet as the pay pages (UX review, batch 004 round 1):
// never Next's bare 404 with no way back.
import Link from "next/link";
import { StaticScene } from "@/components/StaticScene";

export function NotFoundSheet({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-scene-night px-4 py-12">
      <StaticScene />
      <section className="relative grid w-full max-w-[420px] gap-4 rounded-[28px] bg-surface p-8 text-ink shadow-float">
        <h1 className="title">{title}</h1>
        <p className="text-sm text-ink-muted">{children}</p>
        <Link href="/" className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4">
          About WhiteFlow
        </Link>
      </section>
    </main>
  );
}
