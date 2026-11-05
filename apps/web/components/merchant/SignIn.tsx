"use client";

// "Sign in with your wallet" for merchants (SIWE): connect the browser wallet, sign one message (free, moves no
// money), and the server sets a session cookie. Customers never see this; they pay with the guest wallet.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { whitechainSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";
import { Button } from "@/components/Button";

const SIGN_IN_WINDOW_MS = 5 * 60_000;

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export function SignIn({ available }: { available: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    if (!window.ethereum) {
      setError("No wallet found in this browser. On a phone, open this page in your wallet app's browser (MetaMask, Rabby). On a computer, add a wallet extension.");
      return;
    }
    setBusy(true);
    try {
      const wallet = createWalletClient({ chain: whitechainSepolia, transport: custom(window.ethereum) });
      const [address] = await wallet.requestAddresses();
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" });
      const { nonce, error: nonceError } = (await nonceRes.json()) as { nonce?: string; error?: string };
      if (!nonce) throw new Error(nonceError ?? "Sign-in isn't available right now.");
      const message = createSiweMessage({
        address,
        chainId: whitechainSepolia.id,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: "1",
        expirationTime: new Date(Date.now() + SIGN_IN_WINDOW_MS), // the server refuses messages without a short expiry
        statement: "Sign in to your Merchant Capital+ dashboard. This is free and moves no money.",
      });
      const signature = await wallet.signMessage({ account: address, message });
      const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed. Try again.");
      router.refresh();
    } catch (e) {
      const rejected = typeof e === "object" && e !== null && "code" in e && (e as { code?: number }).code === 4001;
      setError(rejected ? "You cancelled the request in your wallet." : e instanceof Error ? e.message : "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-12 grid max-w-md gap-4 rounded-md border border-hairline bg-surface p-8 shadow-card">
      <h1 className="title">Sign in to your dashboard</h1>
      <p className="text-ink-muted">Use the wallet your shop gets paid to. You&apos;ll sign one message; it&apos;s free and moves no money.</p>
      {available ? (
        <Button onClick={signIn} aria-disabled={busy} className="justify-self-start">
          {busy ? "Waiting for your wallet…" : "Sign in with your wallet"}
        </Button>
      ) : (
        <p className="text-sm text-warning">Sign-in isn&apos;t set up on this server yet.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </section>
  );
}

export function SignOut() {
  const router = useRouter();
  return (
    <Button
      variant="quiet"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" });
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
