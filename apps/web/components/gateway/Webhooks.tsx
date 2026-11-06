"use client";

// Webhooks on the Developers screen (FR-GW-7): add an https endpoint (checked here, then by the gateway, which also
// needs a public address), see its signing secret once, and for each endpoint its last 20 deliveries with a status
// pill, tries, the next try and the answer code. "Send test event", "Resend" (the same event id) and a two-step delete.
// At 5 endpoints the form says so instead of failing. The list is read on our server; actions call the gateway from
// this browser, then the list reloads.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { SectionLabel, card, field } from "@/components/gateway/Frame";
import { RevealOnce } from "@/components/gateway/RevealOnce";
import { errorText } from "@/lib/gateway-client";
import { DELIVERY_LABEL, MAX_ENDPOINTS, devClient, httpsProblem, nextTryText, signedOut, type Delivery, type DeliveryStatus, type NewWebhook, type Webhook } from "@/lib/gateway-dev";

/** A delivery with its times already written out on our server. */
export interface DeliveryRow extends Delivery {
  atText: string;
  nextText: string | null;
}
export interface WebhookRow extends Omit<Webhook, "deliveries"> {
  createdText: string;
  deliveries: DeliveryRow[];
}

const TONE: Record<DeliveryStatus, string> = { pending: "text-warning", succeeded: "text-positive", failed: "text-critical" };
const pill = "inline-flex shrink-0 rounded-pill border border-current px-3 py-0.5 text-xs font-medium";
const tries = (n: number) => `${n} ${n === 1 ? "try" : "tries"}`;

export function Webhooks({ hooks }: { hooks: WebhookRow[] }) {
  return (
    <section aria-labelledby="webhooks" className="grid gap-4">
      <SectionLabel id="webhooks">
        Webhooks · {hooks.length} of {MAX_ENDPOINTS} endpoints
      </SectionLabel>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <NewEndpoint full={hooks.length >= MAX_ENDPOINTS} />
        {hooks.length === 0 ? (
          <p className={`${card} text-sm text-ink-muted`}>No endpoints yet. Add your server&apos;s URL and we&apos;ll send it payment.succeeded and payment.refunded.</p>
        ) : (
          <ul className="grid gap-3">
            {hooks.map((hook) => (
              <Endpoint key={hook.id} hook={hook} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NewEndpoint({ full }: { full: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NewWebhook | null>(null); // the only copy of the signing secret: memory, this screen

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const url = String(new FormData(form).get("url") ?? "").trim();
    const problem = httpsProblem(url);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      setCreated(await devClient().addWebhook(url));
      form.reset();
      router.refresh();
    } catch (err) {
      setError(errorText(err)); // the gateway's word: not a public address, host not found, 5 already
      if (signedOut(err)) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-endpoint" className={card}>
      <h3 id="new-endpoint" className="text-[15px] font-medium">
        Add an endpoint
      </h3>
      {full ? (
        <p className="text-sm text-ink-muted">You have {MAX_ENDPOINTS} endpoints, the most you can have. Delete one to add another.</p>
      ) : (
        // noValidate: our own plain sentence instead of the browser's tooltip (which would also let http:// through)
        <form onSubmit={submit} onChange={() => setError(null)} noValidate className="grid gap-4">
          <label className="grid gap-1 text-sm">
            <span className="text-ink-muted">Your endpoint&apos;s URL (https)</span>
            <input name="url" type="url" inputMode="url" maxLength={500} autoComplete="off" spellCheck={false} placeholder="https://shop.example/webhooks" className={`${field} data`} />
          </label>
          <p className="text-sm text-ink-muted">
            We send <code className="data">payment.succeeded</code> and <code className="data">payment.refunded</code>, signed with this endpoint&apos;s secret, and retry
            after 1, 5 and 30 minutes.
          </p>
          <Button type="submit" aria-disabled={busy} className="justify-self-start">
            {busy ? "Adding…" : "Add endpoint"}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      {created && (
        <RevealOnce title={`Signing secret · ${created.url.replace(/^https:\/\//, "")}`} value={created.secret} noun="secret" onDone={() => setCreated(null)}>
          Put it in GATEWAY_WEBHOOK_SECRET on your server. It checks the MC-Signature on every event.
        </RevealOnce>
      )}
    </section>
  );
}

function Endpoint({ hook }: { hook: WebhookRow }) {
  return (
    <li className={`${card} gap-3`}>
      <div className="grid min-w-0 gap-1">
        <span className="eyebrow text-ink-muted">Endpoint · added {hook.createdText}</span>
        <h3 className="data text-[15px] break-all text-ink">{hook.url}</h3>
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-y border-hairline py-1">
        <SendTest hook={hook} />
        <Delete hook={hook} />
      </div>
      {hook.deliveries.length === 0 ? (
        <p className="text-sm text-ink-muted">No events sent yet. Send a test event to check your endpoint.</p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            Last {hook.deliveries.length} {hook.deliveries.length === 1 ? "event" : "events"}, newest first. Resend sends the same event again, with the same event
            id. Receivers ignore repeats by event id.
          </p>
          <ul className="grid">
            {hook.deliveries.map((d) => (
              <DeliveryLine key={d.id} delivery={d} />
            ))}
          </ul>
        </>
      )}
    </li>
  );
}

function DeliveryLine({ delivery: d }: { delivery: DeliveryRow }) {
  const next = nextTryText(d, d.nextText);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-hairline py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_92px_minmax(0,1.3fr)_auto]">
      <span className="data min-w-0 truncate" title={d.event}>
        {d.event}
      </span>
      <span className={`${pill} justify-self-end md:justify-self-start ${TONE[d.status]}`}>{DELIVERY_LABEL[d.status]}</span>
      <span className="col-span-2 text-ink-muted tabular-nums md:col-span-1">
        {d.atText} · {tries(d.attempts)} · {d.response_status === null ? "no answer" : `HTTP ${d.response_status}`}
        {next && ` · ${next}`}
      </span>
      <Resend delivery={d} />
    </li>
  );
}

/** One action button with its own busy state, error and (optional) result line. */
function useAction(run: () => Promise<string | void>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function act() {
    setError(null);
    setDone(null);
    setBusy(true);
    try {
      const said = await run();
      setDone(typeof said === "string" ? said : null);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      if (signedOut(err)) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, act };
}

function SendTest({ hook }: { hook: WebhookRow }) {
  const { busy, error, done, act } = useAction(async () => {
    const d = await devClient().sendTest(hook.id);
    return `Test event sent: ${DELIVERY_LABEL[d.status].toLowerCase()}${d.response_status === null ? ", no answer" : `, HTTP ${d.response_status}`}.`;
  });
  return (
    <div className="grid min-w-0 gap-1">
      <Button variant="quiet" className="justify-self-start text-sm" onClick={act} aria-disabled={busy}>
        {busy ? "Sending…" : "Send test event"}
      </Button>
      <span role="status" className="text-sm text-ink-muted empty:hidden">
        {done}
      </span>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

function Resend({ delivery }: { delivery: DeliveryRow }) {
  const { busy, error, act } = useAction(async () => void (await devClient().resend(delivery.id)));
  return (
    <div className="col-span-2 grid justify-items-start md:col-span-1 md:justify-items-end">
      <Button variant="quiet" className="text-sm" onClick={act} aria-disabled={busy} aria-label={`Resend ${delivery.event} from ${delivery.atText}`}>
        {busy ? "Sending…" : "Resend"}
      </Button>
      {error && (
        <p role="alert" className="max-w-64 text-sm text-critical md:text-right">
          {error}
        </p>
      )}
    </div>
  );
}

function Delete({ hook }: { hook: WebhookRow }) {
  const [confirming, setConfirming] = useState(false);
  const { busy, error, act } = useAction(() => devClient().deleteWebhook(hook.id));
  // deleting is final (its delivery history goes with it), so it takes a second step
  return (
    <div className="grid justify-items-end gap-1">
      {confirming ? (
        <div role="group" aria-label={`Delete the endpoint ${hook.url}?`} className="grid justify-items-end gap-1">
          <p className="max-w-72 text-right text-sm">We stop sending events to this URL, and its delivery history goes too.</p>
          <span className="flex flex-wrap items-center justify-end gap-x-2">
            <Button variant="quiet" className="text-sm whitespace-nowrap" onClick={act} aria-disabled={busy}>
              {busy ? "Deleting…" : "Delete endpoint"}
            </Button>
            <Button variant="quiet" className="text-sm whitespace-nowrap" onClick={() => setConfirming(false)} aria-disabled={busy}>
              Keep it
            </Button>
          </span>
        </div>
      ) : (
        <Button variant="quiet" className="text-sm" onClick={() => setConfirming(true)}>
          Delete
        </Button>
      )}
      {error && (
        <p role="alert" className="max-w-72 text-right text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
