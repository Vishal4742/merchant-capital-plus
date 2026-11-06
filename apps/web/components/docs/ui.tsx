// The /docs building blocks in the approved gateway v2 language (design-refs/gateway-v2-demo.html): mono section
// labels over a rule, objects as cards, night code blocks, tables that stack into cards on a phone. Server components:
// the only browser code is CopyButton. Not imported from components/gateway/Frame.tsx, whose SignIn would ship
// wallet code to this page.
import type { ReactNode } from "react";
import { CopyButton } from "@/components/CopyButton";
import { AUTH, type Auth, type Method } from "@/lib/docs-reference";

export const card = "lift grid min-w-0 content-start gap-4 rounded-[20px] border border-hairline bg-surface p-5 md:p-6";
export const textLink = "text-accent underline underline-offset-4";
/** Halftone grain printed into a surface: one CSS gradient, no image bytes (the same as Frame.tsx's). */
export const grain = "bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--ink)_7%,transparent)_1px,transparent_1.4px)] bg-size-[4px_4px]";
const codeChip = "data rounded-[6px] bg-surface-sunk px-1 py-px text-[0.92em] text-ink [overflow-wrap:anywhere]";

/** Text where `backticks` mark code. */
export function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 ? (
          <code key={i} className={codeChip}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export const Code = ({ children }: { children: ReactNode }) => <code className={codeChip}>{children}</code>;

export function Section({ id, number, label, title, lede, children }: { id: string; number: string; label: string; title: ReactNode; lede?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="grid min-w-0 scroll-mt-24 gap-6 md:scroll-mt-10">
      <div className="grid gap-3">
        <span className="eyebrow border-t border-ink pt-3 text-ink-muted">
          {number} / {label}
        </span>
        <h2 id={`${id}-title`} className="max-w-[22ch] text-[30px] leading-[1.05] font-medium tracking-[-0.035em] md:text-[44px]">
          {title}
        </h2>
        {lede && <p className="max-w-[62ch] text-ink-muted">{lede}</p>}
      </div>
      {children}
    </section>
  );
}

/** One line per span, so whole-line comments can be dimmed; the copied text is the code as written. */
function Lines({ code }: { code: string }) {
  return code.split("\n").map((line, i) => (
    <span key={i} className={/^\s*(\/\/|<!--|#)/.test(line) ? "text-glass-ink/60" : undefined}>
      {line}
      {"\n"}
    </span>
  ));
}

/** A code block with a copy button: focusable and named, so a keyboard can scroll it (UX review 006 F3); it wraps on a
 *  phone and scrolls sideways from md up. */
export function Snippet({ code, name, file }: { code: string; name: string; file: string }) {
  return (
    <figure className="grid min-w-0 overflow-hidden rounded-[14px] border border-hairline bg-surface">
      <figcaption className="flex min-w-0 items-center justify-between gap-3 border-b border-hairline pr-2 pl-4">
        <span className="eyebrow truncate text-ink-muted">{file}</span>
        <span className="flex shrink-0 items-center">
          <CopyButton text={code} name={name} />
        </span>
      </figcaption>
      <pre
        tabIndex={0}
        role="region"
        aria-label={`Code: ${name}`}
        className="data overflow-x-auto bg-scene-night p-4 text-[12px] leading-[1.65] break-words whitespace-pre-wrap text-glass-ink md:text-[12.5px] md:whitespace-pre"
      >
        <code>
          <Lines code={code} />
        </code>
      </pre>
    </figure>
  );
}

/** A short code object inside a card: always wraps, so it never needs to scroll. */
export const MiniCode = ({ code }: { code: string }) => (
  <pre className="data rounded-[14px] bg-scene-night p-4 text-[12px] leading-[1.6] break-words whitespace-pre-wrap text-glass-ink">
    <code>
      <Lines code={code} />
    </code>
  </pre>
);

const CALLOUT = {
  note: { label: "Note", box: "border-accent/40 bg-accent-soft", ink: "text-accent", icon: "M12 11v6m0-10h.01" },
  warning: { label: "Warning", box: "border-warning/50 bg-warning/10", ink: "text-warning", icon: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" },
} as const;

/** A rule worth stopping for: an aside the screen reader announces as a note, named by its label and an icon as well
 *  as its colour. */
export function Callout({ tone = "note", children }: { tone?: keyof typeof CALLOUT; children: ReactNode }) {
  const c = CALLOUT[tone];
  return (
    <aside role="note" aria-label={c.label} className={`flex min-w-0 gap-3 rounded-[14px] border p-4 text-sm ${c.box}`}>
      <svg aria-hidden viewBox="0 0 24 24" className={`mt-0.5 size-4 shrink-0 ${c.ink}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {tone === "note" && <circle cx="12" cy="12" r="10" />}
        <path d={c.icon} />
      </svg>
      <p className="min-w-0 text-ink">
        <strong className={`eyebrow mr-2 font-normal ${c.ink}`}>{c.label}</strong>
        {children}
      </p>
    </aside>
  );
}

/** Where a step runs. Words, not only a colour. */
export const WhereTag = ({ where }: { where: "Server" | "Browser" }) => (
  <span className={`inline-flex w-fit rounded-pill px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${where === "Server" ? "bg-accent-soft text-accent" : "border border-hairline text-ink"}`}>
    {where === "Server" ? "On your server" : "In the browser"}
  </span>
);

const METHOD_TONE: Record<Method, string> = {
  GET: "border-hairline text-ink",
  POST: "border-transparent bg-accent-soft text-accent",
  DELETE: "border-hairline text-critical",
};

export const MethodPill = ({ method }: { method: Method }) => (
  <span className={`data inline-flex h-6 shrink-0 items-center rounded-pill border px-2 text-[11px] font-medium tracking-[0.04em] ${METHOD_TONE[method]}`}>{method}</span>
);

const AUTH_TONE: Record<Auth, string> = {
  secret: "bg-accent-soft text-accent",
  dashboard: "bg-surface-sunk text-ink",
  "dashboard-or-secret": "bg-surface-sunk text-ink",
  public: "border border-hairline text-ink-muted",
};

export const AuthChip = ({ auth }: { auth: Auth }) => (
  <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${AUTH_TONE[auth]}`}>{AUTH[auth].label}</span>
);

/** "/api/v1/public/links/{slug}" with a break opportunity after each slash. */
export const Path = ({ path }: { path: string }) => (
  <code className="data text-ink">
    {path.split("/").map((part, i) => (
      <span key={i}>
        {i > 0 && (
          <>
            /<wbr />
          </>
        )}
        {part}
      </span>
    ))}
  </code>
);

export interface Column {
  label: string;
  width?: string; // a Tailwind width for the desktop table, like "w-[30%]"
  stackLabel?: boolean; // show the label over the cell on a phone (default true)
  phoneHidden?: boolean; // leave the cell out of a phone's card (another cell shows it there)
}

const stackLabel =
  "max-md:before:mb-1 max-md:before:block max-md:before:font-mono max-md:before:text-[11px] max-md:before:leading-4 max-md:before:tracking-[0.06em] max-md:before:text-ink-muted max-md:before:uppercase max-md:before:content-[attr(data-label)]";

/** A table from md up; a stack of cards on a phone, each cell under its column's name. The roles keep the table's
 *  meaning for screen readers when the phone layout changes its display. */
export function DocTable({ caption, columns, rows }: { caption: string; columns: Column[]; rows: { key: string; cells: ReactNode[] }[] }) {
  return (
    <div className="min-w-0 md:overflow-hidden md:rounded-[20px] md:border md:border-hairline md:bg-surface">
      <table role="table" className="w-full border-collapse text-left text-sm max-md:block md:table-fixed">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className="max-md:hidden">
          <tr role="row">
            {columns.map((column) => (
              <th key={column.label} role="columnheader" scope="col" className={`eyebrow border-b border-hairline px-4 py-3 font-normal text-ink-muted ${column.width ?? ""}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="max-md:grid max-md:gap-3">
          {rows.map((row) => (
            <tr
              key={row.key}
              role="row"
              className="border-b border-hairline align-top last:border-b-0 max-md:grid max-md:gap-3 max-md:rounded-[20px] max-md:border max-md:bg-surface max-md:p-4 max-md:last:border-b"
            >
              {row.cells.map((cell, i) => (
                <td
                  key={columns[i].label}
                  role="cell"
                  data-label={columns[i].label}
                  className={`min-w-0 px-4 py-3 break-words max-md:block max-md:p-0 ${columns[i].stackLabel === false ? "" : stackLabel} ${columns[i].phoneHidden ? "max-md:hidden" : ""}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
