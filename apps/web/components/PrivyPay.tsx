"use client";

// Batch 046 (FR-PAY-16): "Pay with your wallet" through Privy, for a customer whose browser has no wallet (a phone).
// Privy's modal connects a phone wallet over WalletConnect (QR on desktop, deep link on a phone), a browser wallet, or
// email (Privy's wallet for this app). A wallet is only connected (useConnectOrCreateWallet: no sign-in message).
// Loaded on the press only (components/WalletPay.tsx), into its own React root, so Privy never touches the sheet's
// first load (NFR-12). It hands back the connected wallet and nothing else; the signing is lib/payer-wallet.ts.
// The attempt's rules (never reuse an earlier session, security 046 M1) are in lib/privy-session.ts.
import { PrivyProvider, useConnectOrCreateWallet, useLogin, useModalStatus, usePrivy, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { WALLET_CANCELLED } from "@/lib/outcome";
import { privyConfig } from "@/lib/privy-config";
import { OPENED_FAILED, endPrivySession, privyAttempt } from "@/lib/privy-session";

type PrivyWallet = Pick<ConnectedWallet, "getEthereumProvider" | "disconnect" | "walletClientType">;
type Attempt = ReturnType<typeof privyAttempt<PrivyWallet>>;
type HookState = { wallets: PrivyWallet[]; logout: () => Promise<void>; getAccessToken?: () => Promise<string | null> };
/** The connected wallet, and close(): disconnect it, sign out of Privy, clear its tokens, remove the Privy tree. */
export interface PrivySession {
  wallet: PrivyWallet;
  close: () => Promise<void>;
  getAccessToken?: () => Promise<string | null>;
}

const EXITED = "exited_auth_flow"; // PrivyErrorCode.USER_EXITED_AUTH_FLOW: the customer closed the modal
const READY_WAIT_MS = 15_000; // Privy loads its app settings first; past this, say so instead of waiting forever
const CLOSED_GRACE_MS = 1_500; // the modal closes a moment before Privy reports the connected wallet
const DRAIN_MS = 5 * 60_000; // after a cancel, a phone wallet may still approve the pairing for about this long

/** Feeds Privy's hook state to the attempt's rules and opens the modal once Privy is ready. */
function Connect({ attempt, onState }: { attempt: Attempt; onState: (state: HookState) => void }) {
  const { ready, authenticated, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { isOpen } = useModalStatus();
  const latest = useRef<PrivyWallet[]>([]);
  const seenOpen = useRef(false);
  useEffect(() => {
    latest.current = wallets;
    onState({ wallets, logout, getAccessToken });
    attempt.wallets(wallets); // the email wallet after this attempt's success; after a cancel, disconnects late ones
  }, [wallets, logout, getAccessToken, attempt, onState]);
  const { connectOrCreateWallet } = useConnectOrCreateWallet({
    onSuccess: ({ wallet }) => {
      if (wallet.type === "ethereum") attempt.succeeded(wallet);
    },
    onError: (code) => attempt.cancel(latest.current, code === EXITED ? WALLET_CANCELLED : OPENED_FAILED),
  });
  // the email sign-in completing (its wallet is listed a moment later); a session from before this attempt isn't one
  useLogin({ onComplete: ({ wasAlreadyAuthenticated }) => wasAlreadyAuthenticated || attempt.succeeded() });
  useEffect(() => {
    if (ready) {
      void attempt.ready(authenticated, logout, connectOrCreateWallet);
      return;
    }
    const id = window.setTimeout(() => attempt.cancel(latest.current, OPENED_FAILED), READY_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [ready, authenticated, logout, connectOrCreateWallet, attempt]);
  // closed with no wallet: a cancel (counted only once the modal has been open)
  useEffect(() => {
    if (isOpen) {
      seenOpen.current = true;
      return;
    }
    if (!seenOpen.current) return;
    const id = window.setTimeout(() => attempt.cancel(latest.current), CLOSED_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [isOpen, attempt]);
  return null;
}

const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return null; // storage blocked: Privy kept nothing here either
  }
};

/** A cancelled attempt's Privy tree, kept to disconnect a phone wallet that approves late; the next attempt ends it. */
let lingering: (() => void) | null = null;

/** Privy's modal for one payment attempt. Resolves with the connected wallet; rejects with one plain sentence. */
export function openPrivy(appId: string, wcProjectId: string | null, landingHeader = "Pay with your wallet"): Promise<PrivySession> {
  lingering?.(); // never two Privy trees on the page
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let state: HookState = { wallets: [], logout: async () => undefined };
  const onState = (next: HookState) => {
    state = next;
  };
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    if (lingering === unmount) lingering = null;
    root.unmount();
    host.remove();
  };
  const end = () => endPrivySession(state.wallets, state.logout, browserStorage());
  const close = async () => {
    try {
      await end();
    } finally {
      unmount();
    }
  };
  return new Promise((resolve, reject) => {
    const attempt = privyAttempt<PrivyWallet>((outcome) => {
      if ("wallet" in outcome) return resolve({ wallet: outcome.wallet, close, getAccessToken: state.getAccessToken });
      void end(); // signed out and tokens cleared now; the tree stays a while to disconnect a late wallet
      lingering = unmount;
      window.setTimeout(unmount, DRAIN_MS);
      reject(new Error(outcome.message));
    });
    root.render(
      <PrivyProvider appId={appId} config={privyConfig(wcProjectId, landingHeader)}>
        <Connect attempt={attempt} onState={onState} />
      </PrivyProvider>,
    );
  });
}
