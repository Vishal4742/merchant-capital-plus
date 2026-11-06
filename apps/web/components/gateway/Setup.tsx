// The setup checklist at the top of Developers (FR-GW-6, FR-GW-7): four steps from a new account to a delivered payment
// event, each done or to do, with a one-line how-to and a jump to the part of the screen (or the screen) that does it.
// Worked out on our server (setupSteps); no hooks, so it renders there.
import { SectionLabel, textLink } from "@/components/gateway/Frame";
import type { SetupStep } from "@/lib/gateway-dev";

export function Setup({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((s) => s.done).length;
  return (
    <section aria-labelledby="setup" className="grid gap-4">
      <SectionLabel id="setup">
        Setup · {done} of {steps.length} done
      </SectionLabel>
      {/* the hairline shows through the 1px gaps, so the cells are ruled at one, two or four columns */}
      <ol className="grid gap-px overflow-hidden rounded-[20px] border border-hairline bg-hairline md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, i) => (
          <li key={step.key} className="grid min-w-0 content-start gap-1 bg-surface p-4 md:p-5">
            <span className={`eyebrow flex items-center gap-2 ${step.done ? "text-positive" : "text-ink-muted"}`}>
              <Mark done={step.done} />
              Step {i + 1} · {step.done ? "Done" : "To do"}
            </span>
            <h3 className="text-[15px] font-medium">{step.title}</h3>
            <p className="text-sm text-ink-muted">{step.how}</p>
            {/* a full load for another screen: it runs under its own headers (security review 005 F-N4) */}
            <a href={step.href} className={`${textLink} justify-self-start`}>
              {step.action}
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Mark({ done }: { done: boolean }) {
  return done ? (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
      <circle cx="8" cy="8" r="8" fill="currentColor" />
      <path d="M4.5 8.2 7 10.6l4.6-5" fill="none" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 shrink-0">
      <circle cx="8" cy="8" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
