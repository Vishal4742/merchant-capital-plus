"use client";

// API keys on the Developers screen (FR-GW-6, test mode only per FR-GW-14): create a publishable or secret key, see it
// once, list the live ones (label, kind, prefix, created, last used) and revoke one in two steps. The list is read on
// our server; creating and revoking call the gateway from this browser, then the list reloads (the new key is never in it).
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { SectionLabel, card, field } from "@/components/gateway/Frame";
import { RevealOnce } from "@/components/gateway/RevealOnce";
import { errorText } from "@/lib/gateway-client";
import { MAX_LABEL, devClient, signedOut, type ApiKey, type KeyKind, type NewKey } from "@/lib/gateway-dev";

/** A key with its times already written out on our server (so the server and browser renders match). */
export interface KeyRow extends ApiKey {
  createdText: string;
  lastUsedText: string | null;
}

const KINDS: Record<KeyKind, { name: string; where: string; stops: string }> = {
  sk: { name: "Secret", where: "On your server only. It creates checkouts and lists payments.", stops: "Your server's calls with this key stop working at once." },
  pk: { name: "Publishable", where: "In the browser, for the pay button. Safe to put in a web page.", stops: "Pay buttons with this key stop working at once." },
};

export function ApiKeys({ keys }: { keys: KeyRow[] }) {
  return (
    <section aria-labelledby="api-keys" className="grid gap-4">
      <SectionLabel id="api-keys">API keys · {keys.length} live · test mode</SectionLabel>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <NewKeyCard />
        {keys.length === 0 ? (
          <p className={`${card} text-sm text-ink-muted`}>No keys yet. Create a secret key for your server, and a publishable one if you use the pay button.</p>
        ) : (
          <ul className="grid gap-3">
            {keys.map((key) => (
              <KeyCard key={key.id} apiKey={key} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NewKeyCard() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<NewKey | null>(null); // the only copy of the new key: memory, this screen

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const label = String(data.get("label") ?? "").trim();
    if (!label) return setError("Give the key a name, like “Shop server”.");
    setBusy(true);
    try {
      setCreated(await devClient().createKey(label, data.get("kind") === "pk" ? "pk" : "sk"));
      form.reset();
      router.refresh(); // the list is read on the server, and never holds the key
    } catch (err) {
      setError(errorText(err));
      if (signedOut(err)) router.refresh(); // the server then shows sign-in
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-key" className={card}>
      <h3 id="new-key" className="text-[15px] font-medium">
        New key
      </h3>
      <form onSubmit={submit} onChange={() => setError(null)} className="grid gap-4">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Name (only you see it)</span>
          <input name="label" maxLength={MAX_LABEL} required autoComplete="off" placeholder="Shop server" className={field} />
        </label>
        <fieldset className="grid gap-2 text-sm">
          <legend className="mb-1 text-ink-muted">Kind</legend>
          {(["sk", "pk"] as const).map((kind) => (
            <label key={kind} className="flex cursor-pointer gap-3 rounded-[14px] border border-hairline p-3 has-checked:border-accent has-checked:bg-accent-soft">
              <input type="radio" name="kind" value={kind} defaultChecked={kind === "sk"} className="mt-0.5 size-5 shrink-0 accent-accent" />
              <span className="grid gap-0.5">
                <span className="font-medium">
                  {KINDS[kind].name} <span className="data font-normal text-ink-muted">{kind}_test_…</span>
                </span>
                <span className="text-ink-muted">{KINDS[kind].where}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Button type="submit" aria-disabled={busy} className="justify-self-start">
          {busy ? "Creating…" : "Create key"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      {created && (
        <RevealOnce title={`New ${KINDS[created.kind].name.toLowerCase()} key · ${created.label}`} value={created.key} noun="key" onDone={() => setCreated(null)}>
          {created.kind === "sk" ? "Put it in GATEWAY_SECRET_KEY on your server. Never put it in a web page or an app." : "It's safe in a web page. It can't create checkouts or read payments."}
        </RevealOnce>
      )}
    </section>
  );
}

function KeyCard({ apiKey }: { apiKey: KeyRow }) {
  const kind = KINDS[apiKey.kind];
  return (
    <li className={`${card} lift gap-3`}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0 text-[17px] leading-snug font-medium break-words">{apiKey.label}</h3>
        <span className={`inline-flex shrink-0 rounded-pill border border-current px-3 py-0.5 text-xs font-medium ${apiKey.kind === "sk" ? "text-accent" : "text-ink-muted"}`}>
          {kind.name} key
        </span>
      </div>
      <p className="data inline-flex justify-self-start rounded-pill border border-hairline bg-surface-sunk px-3 py-1" aria-label={`Starts with ${apiKey.prefix}`}>
        {apiKey.prefix}…
      </p>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-hairline pt-2 text-sm">
        <span className="text-ink-muted">
          Created {apiKey.createdText} · Last used {apiKey.lastUsedText ?? "never"}
        </span>
        <Revoke apiKey={apiKey} />
      </div>
    </li>
  );
}

function Revoke({ apiKey }: { apiKey: KeyRow }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setError(null);
    setBusy(true);
    try {
      await devClient().revokeKey(apiKey.id);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
      if (signedOut(err)) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  // revoking is final, so it takes a second step that says what stops working
  return (
    <div className="grid justify-items-end gap-1">
      {confirming ? (
        <div role="group" aria-label={`Revoke ${apiKey.label}?`} className="grid justify-items-end gap-1">
          <p className="max-w-72 text-right text-sm">{KINDS[apiKey.kind].stops}</p>
          <span className="flex flex-wrap items-center justify-end gap-x-2">
            <Button variant="quiet" className="whitespace-nowrap" onClick={revoke} aria-disabled={busy}>
              {busy ? "Revoking…" : "Revoke key"}
            </Button>
            <Button variant="quiet" className="whitespace-nowrap" onClick={() => setConfirming(false)} aria-disabled={busy}>
              Keep it
            </Button>
          </span>
        </div>
      ) : (
        <Button variant="quiet" onClick={() => setConfirming(true)}>
          Revoke
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
