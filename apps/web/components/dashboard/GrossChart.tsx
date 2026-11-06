// Gross volume for the last 7 or 30 days (approved gateway v2 design): an SVG line over a halftone dot fill, no chart
// library. The figures are the payments the page confirmed on chain. The 7/30 switch is two radio buttons and CSS.
import { chartPaths } from "@/lib/dashboard";

const W = 600;
const H = 220;
const PAD = 24;

export interface GrossRange {
  days: 7 | 30;
  values: number[]; // USDT per IST day, oldest first
  totalText: string;
  change: number | null; // whole percent vs the period before
  fromText: string;
  toText: string;
}

// Tailwind needs whole class names: the 7-day view shows unless 30 is picked
const SHOWN = { 7: "group-has-[#gross-30:checked]:hidden", 30: "hidden group-has-[#gross-30:checked]:block" } as const;
const seg =
  "cursor-pointer rounded-pill px-3 py-1.5 text-xs font-medium text-ink-muted has-[:checked]:bg-surface has-[:checked]:text-ink has-[:checked]:shadow-card has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus";

function Delta({ change, days }: { change: number | null; days: number }) {
  if (change === null) return null;
  return (
    <span className={`eyebrow normal-case ${change >= 0 ? "text-positive" : "text-warning"}`}>
      {change >= 0 ? "▲" : "▼"} {Math.abs(change)}% vs the {days} days before
    </span>
  );
}

export function GrossChart({ ranges }: { ranges: GrossRange[] }) {
  return (
    <section aria-labelledby="gross" className="group lift grid min-w-0 content-start gap-3 rounded-[20px] border border-hairline bg-surface p-5 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="gross" className="eyebrow text-ink-muted">
            Gross volume
          </h2>
          {ranges.map((range) => (
            <div key={range.days} className={SHOWN[range.days]}>
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[30px] leading-9 font-medium tracking-[-0.03em] tabular-nums">{range.totalText}</span>
                <Delta change={range.change} days={range.days} />
              </p>
            </div>
          ))}
        </div>
        <fieldset className="inline-flex rounded-pill bg-surface-sunk p-[3px]">
          <legend className="sr-only">Period</legend>
          <label className={seg}>
            <input type="radio" name="gross-range" id="gross-7" defaultChecked className="sr-only" />7 days
          </label>
          <label className={seg}>
            <input type="radio" name="gross-range" id="gross-30" className="sr-only" />
            30 days
          </label>
        </fieldset>
      </div>
      {ranges.map((range) => {
        const { line, area, last } = chartPaths(range.values, W, H, PAD);
        return (
          <figure key={range.days} className={`${SHOWN[range.days]} min-w-0`}>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Gross volume, last ${range.days} days: ${range.totalText} USDT`}>
              <defs>
                <pattern id={`halftone-${range.days}`} width="4" height="4" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.9" className="fill-scene-dot" fillOpacity="0.35" />
                </pattern>
              </defs>
              {[0.25, 0.5, 0.75].map((f) => (
                <line key={f} x1={PAD} x2={W - PAD} y1={PAD + f * (H - PAD * 2)} y2={PAD + f * (H - PAD * 2)} stroke="currentColor" strokeOpacity="0.08" />
              ))}
              <path d={area} fill={`url(#halftone-${range.days})`} />
              <path d={line} fill="none" className="stroke-accent" strokeWidth="2.2" strokeLinejoin="round" />
              <circle cx={last.x} cy={last.y} r="11" className="fill-accent" fillOpacity="0.15" />
              <circle cx={last.x} cy={last.y} r="5" className="fill-accent" />
            </svg>
            <figcaption className="eyebrow flex justify-between px-1 text-ink-muted">
              <span>{range.fromText}</span>
              <span>{range.toText}</span>
            </figcaption>
          </figure>
        );
      })}
    </section>
  );
}
