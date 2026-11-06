"use client";

// FR-PAY-16 on the checkout and invoice sheets. (1) Before the hold, our server says whether this browser's guest holds
// enough USDT (FR-PRIV-1: no browser chain read); if not, the sheet says so with the guest's address to send test USDT
// to, instead of failing after the hold. (2) "Pay with your wallet": the customer's own injected wallet approves the same
// payment (lib/payer-wallet.ts), one message and no network fee. FR-PAY-7 still holds for the default path: only the
// wallet option, marked data-pay-option="wallet", says "wallet".
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Address } from "viem";
import { Button } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import type { Payer } from "@/lib/sign-sale";
// window.ethereum is typed by the global in components/merchant/SignIn.tsx

type Signer = typeof import("@/lib/sign-sale");
let signer: Promise<Signer> | undefined;
/** The signer (viem + the guest key), loaded once per page after first paint, so it never slows the sheet (NFR-12). */
export const loadSigner = (): Promise<Signer> => (signer ??= import("@/lib/sign-sale"));

type Funds = "enough" | "short" | "unknown";

/** Our server's answer to "does `payer` hold enough USDT for this?"; unknown when it can't say (the pay route checks too). */
async function checkFunds(fundsUrl: string, payer: Address): Promise<Funds> {
  try {
    const res = await fetch(`${fundsUrl}?payer=${payer}`, { cache: "no-store" });
    const data = (await res.json().catch(() => ({}))) as { enough?: unknown };
    if (!res.ok || typeof data.enough !== "boolean") return "unknown";
    return data.enough ? "enough" : "short";
  } catch {
    return "unknown";
  }
}

export const WALLET_SHORT = "This wallet doesn't have enough test USDT for this payment. Nothing was charged.";

/** The customer's own wallet, connected and on chain 1874, and checked by our server to hold enough USDT before the
 *  wallet asks for anything to approve (no prompt for a payment that would fail). Throws plain copy. */
export async function walletPayer(fundsUrl: string): Promise<Payer> {
  const { connectPayer } = await import("@/lib/payer-wallet");
  const payer = await connectPayer(window.ethereum);
  if ((await checkFunds(fundsUrl, payer.address)) === "short") throw new Error(WALLET_SHORT);
  return payer;
}

/** After first paint (when the browser is idle): load the signer, then ask whether this browser's guest holds enough
 *  USDT. A null `fundsUrl` asks nothing (nothing to pay). Asks again on recheck() and when `amountKey` changes. */
export function useGuestFunds(fundsUrl: string | null, amountKey: string) {
  const [state, setState] = useState<{ funds: Funds; address: Address | null }>({ funds: "unknown", address: null });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!fundsUrl) return;
    let live = true;
    const check = () => {
      loadSigner()
        .then(async ({ guestAddress }) => {
          const address = guestAddress();
          const funds = await checkFunds(fundsUrl, address);
          if (live) setState({ funds, address });
        })
        // an unreadable guest key or a failed load: unknown, and the hold says what's wrong, as before this batch
        .catch(() => live && setState({ funds: "unknown", address: null }));
    };
    const hasIdle = typeof window.requestIdleCallback === "function"; // Safari lacks it: fall back to a short timeout
    const id = hasIdle ? window.requestIdleCallback(check) : window.setTimeout(check, 300);
    return () => {
      live = false;
      return hasIdle ? window.cancelIdleCallback(id) : window.clearTimeout(id);
    };
  }, [fundsUrl, amountKey, round]);
  return { ...state, recheck: () => setRound((n) => n + 1) };
}

/** The default path when this browser's guest is short: said before the hold, with the address to send test USDT to.
 *  FR-PAY-7 words only (the wallet option below is the one that says "wallet"). */
export function GuestShort({ amountText, address, onRecheck }: { amountText: string; address: Address; onRecheck: () => void }) {
  return (
    <div role="status" className="grid gap-2 rounded-sm border border-hairline p-4 text-sm">
      <p className="text-warning">This browser doesn&apos;t have {amountText} test USDT yet, so it can&apos;t pay here.</p>
      <p className="text-ink-muted">Send test USDT to this browser&apos;s address, then check again. Or use the option below.</p>
      <p className="data break-all">{address}</p>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={address} name="this browser's address" />
        <Button variant="quiet" className="text-sm" onClick={onRecheck}>
          Check again
        </Button>
      </div>
    </div>
  );
}

// Whether this browser has a wallet: null on the server and during hydration. MetaMask's mobile browser can inject
// window.ethereum after the page loads and says so with this event (the same check as the merchant sign-in).
const subscribeWallet = (onChange: () => void) => {
  window.addEventListener("ethereum#initialized", onChange);
  return () => window.removeEventListener("ethereum#initialized", onChange);
};
const useHasWallet = () =>
  useSyncExternalStore(
    subscribeWallet,
    () => Boolean(window.ethereum),
    () => null,
  );

const outline = "h-12 w-full cursor-pointer rounded-pill border border-current text-base font-medium text-accent hover:bg-accent-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-45";

/** "Pay with your wallet", or where to get one. */
export function WalletOption({ busy, disabled, onPay }: { busy: boolean; disabled: boolean; onPay: () => void }) {
  const found = useHasWallet();
  const off = disabled || !found;
  return (
    <div data-pay-option="wallet" className="grid gap-2">
      <p aria-hidden="true" className="text-center text-xs text-ink-muted">
        or
      </p>
      {found === false ? (
        <p className="text-center text-sm text-ink-muted">
          Have your own wallet with test USDT?{" "}
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-4">
            Install MetaMask<span className="sr-only"> (opens in a new tab)</span>
          </a>
          , then reload this page. On a phone, open this page in your wallet app&apos;s browser.
        </p>
      ) : (
        <>
          <button type="button" className={outline} aria-disabled={off} aria-describedby="wallet-hint" onClick={off ? undefined : onPay}>
            {busy ? "Check your wallet…" : "Pay with your wallet"}
          </button>
          <p id="wallet-hint" className="text-center text-sm text-ink-muted">
            MetaMask or similar, with test USDT. You approve one message. No network fee.
          </p>
        </>
      )}
    </div>
  );
}
