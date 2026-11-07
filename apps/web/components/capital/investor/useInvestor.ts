"use client";

// The investor's wallet for the Capital pages (CAPITAL-TAB §4 I0). On load it reconnects silently to a wallet this site
// may already use (no prompt, no chain switch); Connect asks the wallet and switches it to Whitechain Testnet. It follows
// accountsChanged and chainChanged, so a stale account or chain never stays on screen. Disconnect (batch 063) stops the
// silent reconnect until Connect is pressed again, and asks the wallet to forget this site too.
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { WrongNetwork, connectInvestor, investorError, type InvestorWallet } from "@/lib/capital-wallet";
import { investorOff, setInvestorOff } from "@/lib/investor-off";

export type WalletState =
  | { phase: "checking" }
  | { phase: "disconnected"; error?: string }
  | { phase: "connecting" }
  | { phase: "wrong-network"; account: Address; error?: string }
  | { phase: "ready"; wallet: InvestorWallet };

const store = () => (typeof window === "undefined" ? undefined : window.localStorage);

export function useInvestor(): { state: WalletState; connect: () => void; disconnect: () => void } {
  const [state, setState] = useState<WalletState>({ phase: "checking" });
  const run = useCallback(async (prompt: boolean) => {
    if (!prompt && investorOff(store())) return setState({ phase: "disconnected" }); // they disconnected: no silent reconnect
    if (prompt) {
      setInvestorOff(store(), false);
      setState({ phase: "connecting" });
    }
    try {
      const wallet = await connectInvestor(window.ethereum, { prompt });
      setState(wallet ? { phase: "ready", wallet } : { phase: "disconnected" });
    } catch (error) {
      const message = prompt ? investorError(error) : undefined; // a silent reconnect that fails just shows Connect
      setState(error instanceof WrongNetwork ? { phase: "wrong-network", account: error.account, error: message } : { phase: "disconnected", error: message });
    }
  }, []);

  useEffect(() => {
    const again = () => void run(false);
    again();
    const provider = window.ethereum;
    provider?.on?.("accountsChanged", again);
    provider?.on?.("chainChanged", again);
    return () => {
      provider?.removeListener?.("accountsChanged", again);
      provider?.removeListener?.("chainChanged", again);
    };
  }, [run]);

  const disconnect = useCallback(() => {
    setInvestorOff(store(), true);
    setState({ phase: "disconnected" });
    // EIP-2255: MetaMask and others drop this site's account permission; a wallet without it just keeps its own list
    void window.ethereum?.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
  }, []);

  return { state, connect: useCallback(() => void run(true), [run]), disconnect };
}
