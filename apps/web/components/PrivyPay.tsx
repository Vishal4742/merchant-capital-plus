"use client";

// Batch 046 (FR-PAY-16): "Pay with your wallet" through Privy, for a customer whose browser has no wallet (a phone).
// Privy's modal connects a phone wallet over WalletConnect (QR on desktop, deep link on a phone), a browser wallet, or
// email (Privy's wallet for this app). A wallet is only connected (useConnectOrCreateWallet: no sign-in message).
// Loaded on the press only (components/WalletPay.tsx), into its own React root, so Privy never touches the sheet's
// first load (NFR-12). It hands back the connected wallet and nothing else; the signing is lib/payer-wallet.ts.
import { PrivyProvider, useConnectOrCreateWallet, useModalStatus, usePrivy, useWallets, type ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { WALLET_CANCELLED } from "@/lib/outcome";
import { privyConfig } from "@/lib/privy-config";

type PrivyWallet = Pick<ConnectedWallet, "getEthereumProvider" | "disconnect">;
/** The connected wallet, and close(): disconnect it, sign out of Privy, remove the Privy tree. */
export interface PrivySession {
  wallet: PrivyWallet;
  close: () => Promise<void>;
}
type Result = { wallet: PrivyWallet; logout: () => Promise<void> } | { message: string; logout: () => Promise<void> };

const OPENED_FAILED = "We couldn't open the wallet options. Nothing was charged. Try again.";
const EXITED = "exited_auth_flow"; // PrivyErrorCode.USER_EXITED_AUTH_FLOW: the customer closed the modal
const READY_WAIT_MS = 15_000; // Privy loads its app settings first; past this, say so instead of waiting forever
const CLOSED_GRACE_MS = 1_500; // the modal closes a moment before Privy reports the connected wallet

/** Opens Privy's modal once it's ready and reports the first outcome: a wallet, a cancel, or a failure. */
function Connect({ settle }: { settle: (result: Result) => void }) {
  const { ready, authenticated, logout } = usePrivy();
  const { wallets } = useWallets();
  const { isOpen } = useModalStatus();
  const opened = useRef(false);
  const { connectOrCreateWallet } = useConnectOrCreateWallet({
    onSuccess: ({ wallet }) => {
      if (wallet.type === "ethereum") settle({ wallet, logout });
    },
    onError: (code) => settle({ message: code === EXITED ? WALLET_CANCELLED : OPENED_FAILED, logout }),
  });
  useEffect(() => {
    if (!ready) {
      const id = window.setTimeout(() => settle({ message: OPENED_FAILED, logout }), READY_WAIT_MS);
      return () => window.clearTimeout(id);
    }
    if (opened.current) return;
    opened.current = true;
    connectOrCreateWallet();
  }, [ready, connectOrCreateWallet, settle, logout]);
  // email: Privy's wallet for this app shows up once the customer is signed in
  useEffect(() => {
    const embedded = authenticated ? wallets.find((w) => w.walletClientType === "privy") : undefined;
    if (embedded) settle({ wallet: embedded, logout });
  }, [authenticated, wallets, settle, logout]);
  // closed with no wallet: a cancel
  useEffect(() => {
    if (!opened.current || isOpen) return;
    const id = window.setTimeout(() => settle({ message: WALLET_CANCELLED, logout }), CLOSED_GRACE_MS);
    return () => window.clearTimeout(id);
  }, [isOpen, settle, logout]);
  return null;
}

/** Privy's modal for one payment attempt. Resolves with the connected wallet; rejects with one plain sentence. */
export function openPrivy(appId: string, wcProjectId: string | null): Promise<PrivySession> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  let wallet: PrivyWallet | null = null;
  let logout: (() => Promise<void>) | null = null;
  const close = async () => {
    try {
      wallet?.disconnect(); // ends a WalletConnect session; a no-op for MetaMask
      if (logout) await logout(); // an email customer is signed out after every attempt
    } catch {
      // already disconnected or signed out: nothing left to close
    } finally {
      root.unmount();
      host.remove();
    }
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (result: Result) => {
      if (settled) return;
      settled = true;
      logout = result.logout;
      if ("wallet" in result) {
        wallet = result.wallet;
        return resolve({ wallet: result.wallet, close });
      }
      void close();
      reject(new Error(result.message));
    };
    root.render(
      <PrivyProvider appId={appId} config={privyConfig(wcProjectId)}>
        <Connect settle={settle} />
      </PrivyProvider>,
    );
  });
}
