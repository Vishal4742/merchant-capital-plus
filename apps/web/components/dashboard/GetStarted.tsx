// "Get started" on the dashboard home (batch 024): the four steps from a new wallet to a site that takes payments,
// worked out on our server (lib/onboarding.ts), each with its status and where to do it. The next step's action is the
// one primary button. Once every step is done it folds to one line, "Setup complete", that opens with no JS.
import { buttonClasses } from "@/components/Button";
import { doneCount, type SetupStep, type StepStatus } from "@/lib/onboarding";

const STATUS: Record<StepStatus, { text: string; tone: string }> = {
  done: { text: "Done", tone: "text-positive" },
  todo: { text: "To do", tone: "text-ink-muted" },
  unknown: { text: "Can't check now", tone: "text-warning" },
};
const link = "inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4";
const box = "rounded-[20px] border border-hairline bg-surface";

function Steps({ steps, next }: { steps: SetupStep[]; next: number }) {
  return (
    <ol className="grid divide-y divide-hairline border-t border-hairline">
      {steps.map((step, i) => {
        const status = STATUS[step.status];
        return (
          <li key={step.title} className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 gap-y-2 py-4 md:grid-cols-[32px_minmax(0,1fr)_auto] md:items-center md:gap-x-6">
            <span
              aria-hidden="true"
              className={`data grid size-8 place-items-center rounded-full border ${step.status === "done" ? "border-current text-positive" : i === next ? "border-accent text-accent" : "border-hairline text-ink-muted"}`}
            >
              {step.status === "done" ? "✓" : i + 1}
            </span>
            <div className="grid min-w-0 gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="text-[15px] font-medium">{step.title}</h3>
                <span className={`eyebrow rounded-pill border border-current px-2.5 py-0.5 ${status.tone}`}>{i === next ? "Next" : status.text}</span>
              </div>
              <p className="text-sm text-ink-muted">{step.text}</p>
            </div>
            <div className="col-start-2 flex flex-wrap items-center gap-x-5 gap-y-1 md:col-start-3 md:justify-end">
              {step.actions.map((action, j) => (
                <a key={action.href + action.label} href={action.href} className={i === next && j === 0 ? buttonClasses("primary", "h-11! px-5! text-sm") : link}>
                  {action.label}
                </a>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function GetStarted({ steps }: { steps: SetupStep[] }) {
  const done = doneCount(steps);
  const next = steps.findIndex((step) => step.status === "todo");
  const tally = `${done} of ${steps.length} done`;
  if (done === steps.length) {
    return (
      <details className={`group ${box}`}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 md:px-6 [&::-webkit-details-marker]:hidden">
          <span className="text-[15px] font-medium">
            <span aria-hidden="true" className="text-positive">
              ✓{" "}
            </span>
            Setup complete
          </span>
          <span className="eyebrow flex items-center gap-2 text-ink-muted">
            {tally}
            <span aria-hidden="true" className="transition-transform group-open:rotate-180">
              ▾
            </span>
          </span>
        </summary>
        <div className="px-5 md:px-6">
          <Steps steps={steps} next={-1} />
        </div>
      </details>
    );
  }
  return (
    <section aria-labelledby="get-started" className={`${box} grid gap-4 p-5 pb-1 md:px-6`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="grid gap-1">
          <h2 id="get-started" className="text-[15px] font-medium">
            Get started
          </h2>
          <p className="text-sm text-ink-muted">From a new wallet to your first payment in a few minutes.</p>
        </div>
        <p className="eyebrow text-ink-muted">{tally}</p>
      </div>
      <div aria-hidden="true" className="grid grid-cols-4 gap-1.5">
        {steps.map((step) => (
          <span key={step.title} className={`h-1 rounded-full ${step.status === "done" ? "bg-positive" : "bg-surface-sunk"}`} />
        ))}
      </div>
      <Steps steps={steps} next={next} />
    </section>
  );
}
