"use client";

// FR-PAY-16 on the checkout and invoice sheets. (1) Before the hold, our server says whether this browser's guest holds
// enough USDT (FR-PRIV-1: no browser chain read); if not, the sheet says so in one line and leads with "Pay with your
// wallet", the path that can pay (UX review 032 M1), with funding this browser folded under a quiet disclosure, so the
// default view shows no address (NFR-6, UX review 032 M2). (2) "Pay with your wallet": the customer's own injected wallet
// approves the same payment (lib/payer-wallet.ts), one message and no network fee. FR-PAY-7 still holds for the default
// path: only the wallet option, marked data-pay-option="wallet", says "wallet".
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { Address } from "viem";
import { Button, buttonClasses } from "@/components/Button";
import { CopyButton } from "@/components/CopyButton";
import { FAILED, WALLET_SHORT } from "@/lib/outcome";
import { privyAppId, walletConnectProjectId } from "@/lib/privy-config";
import type { Payer } from "@/lib/sign-sale";
import type { PrivySession } from "@/components/PrivyPay";
// window.ethereum is typed by the global in components/merchant/SignIn.tsx

type Signer = typeof import("@/lib/sign-sale");
let signer: Promise<Signer> | undefined;
/** The signer (viem + the guest key), loaded once per page after first paint, so it never slows the sheet (NFR-12). */
export const loadSigner = (): Promise<Signer> => (signer ??= import("@/lib/sign-sale"));

type Funds = "enough" | "short" | "unknown";
// a hung chain read must not hold the wallet prompt back: past this it's unknown, and the pay route checks (security 032 L3)
const FUNDS_WAIT_MS = 5_000;

/** Our server's answer to "does `payer` hold enough USDT for this?"; unknown when it can't say (the pay route checks too). */
async function checkFunds(fundsUrl: string, payer: Address): Promise<Funds> {
  try {
    const res = await fetch(`${fundsUrl}?payer=${payer}`, { cache: "no-store", signal: AbortSignal.timeout(FUNDS_WAIT_MS) });
    const data = (await res.json().catch(() => ({}))) as { enough?: unknown };
    if (!res.ok || typeof data.enough !== "boolean") return "unknown";
    return data.enough ? "enough" : "short";
  } catch {
    return "unknown";
  }
}

/** How the customer's own wallet comes in: the browser's (window.ethereum), or Privy's modal (batch 046: a phone wallet
 *  over WalletConnect, a browser wallet, or email). */
export type WalletVia = "wallet" | "privy";

let privySession: PrivySession | null = null;
/** After every attempt (paid, cancelled or failed): disconnect the Privy wallet and sign out, if Privy was used. */
export function endWalletSession(): void {
  const session = privySession;
  privySession = null;
  void session?.close();
}

/** The customer's own wallet, connected and on chain 1874, with no funds check (the invoice acknowledgement, batch 047,
 *  moves no money). Throws plain copy. */
export async function connectVia(via: WalletVia): Promise<Payer> {
  const { connectPayer, privyPayer } = await import("@/lib/payer-wallet");
  if (via === "wallet") return connectPayer(window.ethereum);
  const appId = privyAppId();
  if (!appId) throw new Error(FAILED); // the button only shows with an app ID
  const { openPrivy } = await import("@/components/PrivyPay");
  privySession = await openPrivy(appId, walletConnectProjectId());
  return privyPayer(privySession.wallet);
}

/** The customer's own wallet, connected and on chain 1874, and checked by our server to hold enough USDT before the
 *  wallet asks for anything to approve (no prompt for a payment that would fail). Throws plain copy. */
export async function walletPayer(fundsUrl: string, via: WalletVia = "wallet"): Promise<Payer> {
  const payer = await connectVia(via);
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

const shortAddress = (a: Address) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** The default path when this browser's guest is short, said before the hold: one line, then `children` (the wallet
 *  option, as the primary action), then funding this browser under a quiet disclosure. FR-PAY-7 words only here (the
 *  wallet option is the one that says "wallet"); the address shows only once the disclosure is opened. */
export function GuestShort({ amountText, address, onRecheck, children }: { amountText: string; address: Address; onRecheck: () => void; children: ReactNode }) {
  return (
    <div className="grid gap-3">
      <p role="status" className="text-center text-sm text-warning">
        This browser doesn&apos;t have {amountText} test USDT yet, so it can&apos;t pay here.
      </p>
      {children}
      <details className="group text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-ink-muted underline underline-offset-4 hover:text-ink [&::-webkit-details-marker]:hidden">
          Add test USDT to this browser instead
          <span aria-hidden="true" className="transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="grid gap-1 pt-1">
          <p className="text-ink-muted">Send test USDT to this browser&apos;s address, then check again.</p>
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="data" title={address}>
              {shortAddress(address)}
            </span>
            {/* copies the full address; the screen shows it shortened (UX review 032 L5) */}
            <CopyButton text={address} name="this browser's address" />
            <Button variant="quiet" className="text-sm" onClick={onRecheck}>
              Check again
            </Button>
          </div>
        </div>
      </details>
    </div>
  );
}

// Whether this browser has a wallet: null on the server and during hydration. MetaMask's mobile browser can inject
// window.ethereum after the page loads and says so with this event (the same check as the merchant sign-in).
const subscribeWallet = (onChange: () => void) => {
  window.addEventListener("ethereum#initialized", onChange);
  return () => window.removeEventListener("ethereum#initialized", onChange);
};
export const useHasWallet = () =>
  useSyncExternalStore(
    subscribeWallet,
    () => Boolean(window.ethereum),
    () => null,
  );

const outline = "h-12 w-full cursor-pointer rounded-pill border border-current text-base font-medium text-accent hover:bg-accent-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-45";

const quiet = "inline-flex min-h-11 cursor-pointer items-center justify-self-center text-sm font-medium text-accent underline underline-offset-4 hover:text-accent-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-45";

interface WalletOptionProps {
  /** The way in that's waiting on the customer, if any. */
  busy: string | null;
  disabled: boolean;
  onPay: (via: WalletVia) => void;
  primary?: boolean;
}

/** "Pay with your wallet", or where to get one. `primary`: the guest is short, so this is the way to pay: the filled
 *  button "Hold to pay" has when funded, and no "or" above it. With a Privy app ID (batch 046) a browser without a
 *  wallet (a phone) still gets the button, through Privy; a browser with one also gets "Use another wallet or email". */
export function WalletOption({ busy, disabled, onPay, primary = false }: WalletOptionProps) {
  const found = useHasWallet();
  const privy = privyAppId();
  const off = disabled || !found;
  const main = primary ? buttonClasses("primary", "w-full") : outline;
  const browser = found !== false; // null while hydrating: the browser button shows, held, as before
  return (
    <div data-pay-option="wallet" className="grid gap-2">
      {!primary && (
        <p aria-hidden="true" className="text-center text-xs text-ink-muted">
          or
        </p>
      )}
      {privy && (
        <>
          {browser && (
            <button type="button" className={main} aria-disabled={off} aria-describedby="wallet-hint" onClick={off ? undefined : () => onPay("wallet")}>
              {busy === "wallet" ? "Check your wallet…" : "Pay with your browser wallet"}
            </button>
          )}
          <button type="button" className={browser ? quiet : main} aria-disabled={disabled} aria-describedby="wallet-hint privy-notice" onClick={disabled ? undefined : () => onPay("privy")}>
            {busy === "privy" ? "Finish in the wallet window…" : browser ? "Use another wallet or email" : "Pay with your wallet"}
          </button>
          <p id="wallet-hint" className="text-center text-sm text-ink-muted">
            A browser or phone wallet, or your email, with test USDT. You approve one message. No network fee.
          </p>
          {/* who sees what before the customer opens it (security 046 M2) */}
          <p id="privy-notice" className="text-center text-xs text-ink-muted">
            Opens Privy and WalletConnect. They see your IP address, and with email, your email and wallet address.
          </p>
        </>
      )}
      {privy ? null : found === false ? (
        <p className="text-center text-sm text-ink-muted">
          Have your own wallet with test USDT?{" "}
          <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-4">
            Install MetaMask<span className="sr-only"> (opens in a new tab)</span>
          </a>
          , then reload this page. On a phone, open this page in your wallet app&apos;s browser.
        </p>
      ) : (
        <>
          <button type="button" className={main} aria-disabled={off} aria-describedby="wallet-hint" onClick={off ? undefined : () => onPay("wallet")}>
            {busy === "wallet" ? "Check your wallet…" : "Pay with your wallet"}
          </button>
          <p id="wallet-hint" className="text-center text-sm text-ink-muted">
            MetaMask or similar, with test USDT. You approve one message. No network fee.
          </p>
        </>
      )}
    </div>
  );
}
