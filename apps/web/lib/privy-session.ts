// One "Pay with your wallet" attempt through Privy (batch 046), as plain rules so node:test covers them;
// components/PrivyPay.tsx feeds them Privy's hook state. Security review 046 M1: a checkout never reuses an earlier
// Privy session. A session already signed in before this attempt is signed out before the modal opens; Privy's email
// wallet counts only after this attempt's own success callback; closing clears Privy's local tokens before the
// server-side sign-out is awaited; and after a cancel, any wallet still connected, or connecting late (a phone wallet
// that approves after the modal closed), is disconnected.
import { WALLET_CANCELLED } from "./outcome.ts";

/** The parts of Privy's connected wallet this file uses. */
export interface AttemptWallet {
  walletClientType: string;
  disconnect: () => void;
}
export type Outcome<W extends AttemptWallet> = { wallet: W } | { message: string };

export const OPENED_FAILED = "We couldn't open the wallet options. Nothing was charged. Try again.";
const EMBEDDED = "privy"; // walletClientType of Privy's own (email) wallet

/** Every key Privy keeps in this browser (tokens, the analytics ID privy:caid, wallet connections). */
export function clearPrivyStorage(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((k): k is string => k?.startsWith("privy:") ?? false);
  for (const key of keys) storage.removeItem(key);
}

const disconnectAll = (wallets: readonly AttemptWallet[]) => {
  for (const wallet of wallets) {
    try {
      wallet.disconnect(); // ends a WalletConnect session; a no-op for MetaMask
    } catch {
      // already gone
    }
  }
};

/** Ends the session: wallets disconnected, Privy's local tokens removed synchronously, then the sign-out awaited. The
 *  sign-out starts first so it can still read its token; the local copies are gone even if it hangs or fails. */
export async function endPrivySession(wallets: readonly AttemptWallet[], logout: () => Promise<void>, storage: Pick<Storage, "length" | "key" | "removeItem"> | null): Promise<void> {
  disconnectAll(wallets);
  let revoke: Promise<void>;
  try {
    revoke = logout();
  } catch (error) {
    revoke = Promise.reject(error);
  }
  if (storage) clearPrivyStorage(storage); // synchronously, before the await below
  await revoke.catch(() => undefined); // signed out already, or Privy unreachable: nothing left here to reuse
}

/** The rules for one attempt. `settle` hears the first outcome only. */
export function privyAttempt<W extends AttemptWallet>(settle: (outcome: Outcome<W>) => void) {
  let opened = false;
  let succeeded = false;
  let cancelled = false;
  let done = false;
  const finish = (outcome: Outcome<W>) => {
    if (done) return;
    done = true;
    settle(outcome);
  };
  return {
    get settled() {
      return done;
    },
    /** Privy is ready: a session from before this attempt is signed out first, then the modal opens (once). */
    async ready(authenticated: boolean, logout: () => Promise<void>, open: () => void): Promise<void> {
      if (opened) return;
      opened = true;
      try {
        if (authenticated) await logout();
        open();
      } catch {
        finish({ message: OPENED_FAILED });
      }
    },
    /** This attempt's own success callback: a connected wallet, or (email) the sign-in completing with no wallet yet. */
    succeeded(wallet?: W): void {
      if (cancelled) {
        if (wallet) disconnectAll([wallet]); // connected after the cancel
        return;
      }
      succeeded = true;
      if (wallet) finish({ wallet });
    },
    /** Privy's connected wallets changed. Privy's email wallet counts only after this attempt's own success; after a
     *  cancel, every wallet that shows up is disconnected. */
    wallets(list: readonly W[]): void {
      if (cancelled) {
        disconnectAll(list);
        return;
      }
      const embedded = succeeded ? list.find((w) => w.walletClientType === EMBEDDED) : undefined;
      if (embedded) finish({ wallet: embedded });
    },
    /** The modal closed with no wallet, or Privy failed: disconnect every wallet connected so far. */
    cancel(list: readonly W[], message: string = WALLET_CANCELLED): void {
      if (done) return;
      cancelled = true;
      disconnectAll(list);
      finish({ message });
    },
  };
}
