"use client";

// The steps every Capital listing shares (CAPITAL-TAB §4 M1 "pending"): the wallet sends the listing → receipt →
// publish to the offer book → the page re-reads the chain. Plus the two-step Cancel for an offer nobody has funded.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { EXPLORER } from "@/lib/usdt";
import { settlePublish, startPublish } from "./publishing";
import { publishOffer } from "./terms";
import { SENT_UNCONFIRMED, cancelOffer, capitalError, connectCapital, type Listed, type MerchantWallet } from "./wallet";

export type ListingState =
  | { phase: "idle" }
  | { phase: "wallet" }
  | { phase: "publishing"; listed: Listed }
  | { phase: "done"; listed: Listed; entityKey: string }
  | { phase: "unpublished"; listed: Listed; message: string }
  | { phase: "unconfirmed" }
  | { phase: "error"; message: string };

export const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;
export const busy = (s: ListingState) => s.phase === "wallet" || s.phase === "publishing";

/** Runs one listing; the state survives the refresh that swaps the form for the running offer. */
export function useListing(merchant: Address) {
  const router = useRouter();
  const [state, setState] = useState<ListingState>({ phase: "idle" });
  async function run(list: (w: MerchantWallet) => Promise<Listed>) {
    if (busy(state)) return;
    setState({ phase: "wallet" });
    let done: Listed;
    try {
      done = await list(await connectCapital(merchant));
    } catch (err) {
      const message = capitalError(err);
      setState(message === SENT_UNCONFIRMED ? { phase: "unconfirmed" } : { phase: "error", message });
      return;
    }
    setState({ phase: "publishing", listed: done });
    startPublish(done.claimId); // no Publish again on this offer until this settles and the book is read again
    try {
      setState({ phase: "done", listed: done, entityKey: await publishOffer(done.claimId) });
    } catch (err) {
      setState({ phase: "unpublished", listed: done, message: err instanceof Error ? err.message : "The offer book didn't answer." });
    } finally {
      settlePublish(done.claimId);
    }
    router.refresh(); // the advance, the offers and the book are read on the server
  }
  const fail = (message: string) => setState({ phase: "error", message });
  const clear = () => state.phase === "error" && setState({ phase: "idle" });
  return { state, run, fail, clear };
}

const txLink = (listed: Listed) => (
  <a href={`${EXPLORER}/tx/${listed.txHash}`} target="_blank" rel="noreferrer" className="data text-accent underline underline-offset-4">
    {short(listed.txHash)}
  </a>
);

/** What the last listing is doing, in one place under the form. */
export function ListingStatus({ state }: { state: ListingState }) {
  const box = "grid gap-2 rounded-sm border border-hairline p-4 text-sm";
  switch (state.phase) {
    case "idle":
      return null;
    case "wallet":
      return (
        <p role="status" className="text-sm text-ink-muted">
          Waiting for your wallet…
        </p>
      );
    case "publishing":
      return (
        <p role="status" className="text-sm text-ink-muted">
          Offer {state.listed.claimId} is listed ({txLink(state.listed)}). Adding it to the offer book…
        </p>
      );
    case "done":
      return (
        <div role="status" className={`${box} bg-accent-soft`}>
          <p>
            Offer {state.listed.claimId} is listed ({txLink(state.listed)}) and in the offer book, where investors can fund it.
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-ink-muted">
            Offer book entry <span className="data text-ink">{short(state.entityKey)}</span>
            <CopyButton text={state.entityKey} name="the offer book entry key" />
          </p>
        </div>
      );
    case "unpublished":
      return (
        // said once (UX 036 F4): the state, the reason, what to do
        <p role="alert" className={`${box} text-warning`}>
          Offer {state.listed.claimId} is listed on chain ({txLink(state.listed)}) but isn&apos;t in the offer book yet. {state.message} Use Publish again on it under My live offers instead of listing it again.
        </p>
      );
    case "unconfirmed":
      return (
        <div role="status" className={box}>
          <p className="text-warning">{SENT_UNCONFIRMED}</p>
          <button type="button" onClick={() => window.location.reload()} className="inline-flex min-h-11 items-center justify-self-start font-medium text-accent underline underline-offset-4">
            Check again
          </button>
        </div>
      );
    case "error":
      return (
        <p role="alert" className="text-sm text-critical">
          {state.message}
        </p>
      );
  }
}

/** Cancel takes a second step (Invoices.tsx pattern); CapitalMarket allows it only while nobody has funded the offer. */
export function CancelOffer({ merchant, claimId }: { merchant: Address; claimId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function cancel() {
    if (working) return;
    setError(null);
    setWorking(true);
    try {
      await cancelOffer(await connectCapital(merchant), BigInt(claimId));
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(capitalError(err));
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="grid justify-items-start gap-1 sm:justify-items-end">
      {confirming ? (
        <span role="group" aria-label={`Cancel offer ${claimId}?`} className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="whitespace-nowrap">Cancel offer?</span>
          <Button variant="quiet" className="whitespace-nowrap" onClick={cancel} aria-disabled={working}>
            {working ? "Cancelling…" : "Yes, cancel"}
          </Button>
          <Button variant="quiet" className="whitespace-nowrap" onClick={() => setConfirming(false)} aria-disabled={working}>
            Keep it
          </Button>
        </span>
      ) : (
        <Button variant="quiet" className="text-sm" onClick={() => setConfirming(true)}>
          Cancel
        </Button>
      )}
      {error && (
        <p role="alert" className="max-w-72 text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

/** The offer-book deadlines a listing can pick: short enough for the AT-9 throwaway, long enough for a real one. */
export const DEADLINES = [
  { label: "5 minutes", seconds: 300 },
  { label: "1 hour", seconds: 3_600 },
  { label: "1 day", seconds: 86_400 },
  { label: "7 days", seconds: 604_800 },
  { label: "30 days", seconds: 2_592_000 },
] as const;
export const DEFAULT_DEADLINE = 86_400;
