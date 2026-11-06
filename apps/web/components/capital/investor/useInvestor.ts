"use client";

// The investor's wallet for the Capital pages (CAPITAL-TAB §4 I0). On load it reconnects silently to a wallet this site
// may already use (no prompt, no chain switch); Connect asks the wallet and switches it to Whitechain Testnet. It follows
// accountsChanged and chainChanged, so a stale account or chain never stays on screen.
import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { WrongNetwork, connectInvestor, investorError, type InvestorWallet } from "@/lib/capital-wallet";

export type WalletState =
  | { phase: "checking" }
  | { phase: "disconnected"; error?: string }
  | { phase: "connecting" }
  | { phase: "wrong-network"; account: Address; error?: string }
  | { phase: "ready"; wallet: InvestorWallet };

export function useInvestor(): { state: WalletState; connect: () => void } {
  const [state, setState] = useState<WalletState>({ phase: "checking" });
  const run = useCallback(async (prompt: boolean) => {
    if (prompt) setState({ phase: "connecting" });
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

  return { state, connect: useCallback(() => void run(true), [run]) };
}
