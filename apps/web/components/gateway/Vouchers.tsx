"use client";

// Vouchers on the dashboard (FR-GW-12): create a code (percent or a fixed USDT amount off, an end, a usage limit, an
// optional minimum order), see each one as a ticket with its uses and its Arkiv entity, and deactivate one in two steps.
// The list is read on our server; creating and deactivating call the gateway from this browser (same origin, the
// sign-in cookie goes along), then the list reloads.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { SectionLabel, card, field } from "@/components/gateway/Frame";
import { errorText } from "@/lib/gateway-client";
import { amountText } from "@/lib/gateway-forms";
import { discountText, moneyClient, voucherBody, type Voucher, type VoucherKind, type VoucherStatus } from "@/lib/gateway-money";

/** A voucher with its end written out and its status worked out on our server (so both renders match). */
export interface VoucherRow extends Voucher {
  expiresText: string;
  status: VoucherStatus;
}

const STATUS: Record<VoucherStatus, string> = { active: "Active", used_up: "Used up", expired: "Expired", off: "Deactivated" };
// the ticket's two notches sit on the stub's dashed edge (approved gateway v2 design, the SAVE10 ticket)
const notches =
  "before:absolute before:-top-[13px] before:right-[91px] before:size-[26px] before:rounded-full before:bg-ground before:content-[''] " +
  "after:absolute after:right-[91px] after:-bottom-[13px] after:size-[26px] after:rounded-full after:bg-ground after:content-['']";

export function VouchersScreen({ vouchers }: { vouchers: VoucherRow[] }) {
  return (
    <div className="grid gap-8 px-4 py-6 md:px-8 md:py-8">
      <NewVoucher />
      <section aria-labelledby="your-codes" className="grid gap-4">
        <SectionLabel id="your-codes">Your codes · {vouchers.length}</SectionLabel>
        {vouchers.length === 0 ? (
          <p className="text-sm text-ink-muted">No codes yet. Create one above, then share it with your customers.</p>
        ) : (
          <ul className="grid items-start gap-x-4 gap-y-6 md:grid-cols-2 2xl:grid-cols-3">
            {vouchers.map((v) => (
              <VoucherTicket key={v.id} v={v} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function NewVoucher() {
  const router = useRouter();
  const [kind, setKind] = useState<VoucherKind>("percent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => String(data.get(name) ?? "");
    const checked = voucherBody({ code: value("code"), kind, value: value("value"), expires: value("expires"), limit: value("limit"), minOrder: value("min") });
    if (!checked.ok) return setError(checked.error);
    setBusy(true);
    setCreated(null);
    try {
      setCreated((await moneyClient().createVoucher(checked.value)).code);
      form.reset();
      setKind("percent");
      router.refresh(); // the list is read on the server
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="new-code" className={card}>
      <h2 id="new-code" className="text-[15px] font-medium">
        New voucher code
      </h2>
      <form onSubmit={submit} onChange={() => setError(null)} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Code (customers type this)</span>
          {/* shown in capitals as typed; sent in capitals too */}
          <input name="code" required minLength={3} maxLength={32} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="SAVE10" className={`${field} font-mono uppercase placeholder:normal-case`} />
        </label>
        <fieldset className="grid gap-1 text-sm">
          <legend className="mb-1 text-ink-muted">Discount</legend>
          <div className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-1">
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" value="percent" checked={kind === "percent"} onChange={() => setKind("percent")} className="size-5 accent-accent" />
              Percent off
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="kind" value="fixed" checked={kind === "fixed"} onChange={() => setKind("fixed")} className="size-5 accent-accent" />
              USDT off
            </label>
          </div>
        </fieldset>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">{kind === "percent" ? "Percent off (1 to 100)" : "USDT off"}</span>
          <input name="value" required inputMode={kind === "percent" ? "numeric" : "decimal"} autoComplete="off" placeholder={kind === "percent" ? "10" : "5.00"} className={`${field} tabular-nums`} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Stops working</span>
          <input name="expires" type="datetime-local" required className={field} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Can be used (times)</span>
          <input name="limit" required inputMode="numeric" autoComplete="off" placeholder="100" className={`${field} tabular-nums`} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-ink-muted">Minimum order, USDT (optional)</span>
          <input name="min" inputMode="decimal" autoComplete="off" placeholder="20.00" className={`${field} tabular-nums`} />
        </label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 md:col-span-2 xl:col-span-3">
          <Button type="submit" aria-disabled={busy}>
            {busy ? "Creating…" : "Create code"}
          </Button>
          <p className="text-xs text-ink-muted">Customers enter it when they pay one of your links or pages. One code per order.</p>
        </div>
      </form>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      {created && (
        <p role="status" className="rounded-[16px] border border-hairline bg-accent-soft p-4 text-sm">
          <span className="font-mono font-medium">{created}</span> is ready. Share it with your customers.
        </p>
      )}
    </section>
  );
}

function VoucherTicket({ v }: { v: VoucherRow }) {
  const live = v.status === "active";
  return (
    <li className="grid min-w-0 content-start gap-2">
      <div className={`relative grid grid-cols-[minmax(0,1fr)_104px] overflow-hidden rounded-[22px] ${notches} ${live ? "bg-scene-dot text-white" : "border border-dashed border-ink-muted/40 bg-surface-sunk text-ink-muted"}`}>
        <div className="grid min-w-0 content-start gap-1 p-5">
          <span className="eyebrow opacity-80">{STATUS[v.status]}</span>
          <h3 className="font-mono text-[28px] leading-tight font-medium tracking-[0.02em] break-all">{v.code}</h3>
          <p className="text-sm">
            {discountText(v)}
            {v.min_amount && ` · orders from ${amountText(v.min_amount)} USDT`}
          </p>
          <p className="text-sm opacity-85">
            {v.status === "expired" ? "Ended" : "Ends"} {v.expiresText}
          </p>
        </div>
        <div className={`grid place-content-center border-l-2 border-dashed px-2 text-center ${live ? "border-white/40" : "border-ink-muted/30"}`}>
          <b className="text-[30px] leading-none font-medium tabular-nums">{v.times_redeemed}</b>
          <span className="eyebrow mt-1 opacity-80">of {v.max_redemptions} used</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 px-1 text-sm">
        <ArkivKey v={v} />
        {v.active && v.status !== "expired" && <Deactivate v={v} />}
      </div>
    </li>
  );
}

function ArkivKey({ v }: { v: VoucherRow }) {
  const key = v.arkiv_entity_key;
  // the publish route refuses expired and deactivated codes (409), so only a live one offers the retry
  if (!key && v.active && v.status !== "expired") return <Publish v={v} />;
  if (!key) return <span className="inline-flex min-h-11 items-center text-ink-muted">Not on Arkiv</span>;
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="text-ink-muted">Arkiv entity</span>
      <span className="data" title={key}>
        {key.slice(0, 8)}…{key.slice(-6)}
      </span>
      <CopyButton text={key} name={`the Arkiv entity key for ${v.code}`} />
    </span>
  );
}

/** Retries the code's Arkiv mirror (FR-GW-12, batch 028). One Arkiv write can take up to 3 minutes. */
function Publish({ v }: { v: Voucher }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publish() {
    setError(null);
    setBusy(true);
    try {
      const { voucher, arkivError } = await moneyClient().publishVoucher(v.id);
      if (voucher.arkiv_entity_key) return router.refresh(); // the card re-renders with its entity
      setError(arkivError ?? "It isn't on Arkiv yet. Try again in a few minutes.");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid justify-items-start">
      <span className="flex flex-wrap items-center gap-x-2">
        <span className="text-ink-muted">Not on Arkiv</span>
        <Button variant="quiet" className="whitespace-nowrap" onClick={publish} aria-disabled={busy}>
          {busy ? "Publishing…" : "Publish to Arkiv"}
        </Button>
      </span>
      {error && (
        <p role="alert" className="max-w-64 text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

function Deactivate({ v }: { v: Voucher }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deactivate() {
    setError(null);
    setBusy(true);
    try {
      await moneyClient().deactivateVoucher(v.id);
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  // a deactivated code can't be turned back on, so it takes a second step (as cancelling a link does)
  return (
    <div className="grid justify-items-end">
      {confirming ? (
        <span role="group" aria-label={`Deactivate ${v.code}?`} className="flex flex-wrap items-center justify-end gap-x-2">
          <span className="whitespace-nowrap">Stop {v.code} now?</span>
          <Button variant="quiet" className="whitespace-nowrap" onClick={deactivate} aria-disabled={busy}>
            {busy ? "Deactivating…" : "Yes, deactivate"}
          </Button>
          <Button variant="quiet" className="whitespace-nowrap" onClick={() => setConfirming(false)} aria-disabled={busy}>
            Keep it
          </Button>
        </span>
      ) : (
        <Button variant="quiet" onClick={() => setConfirming(true)}>
          Deactivate
        </Button>
      )}
      {error && (
        <p role="alert" className="max-w-64 text-right text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}
