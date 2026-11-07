"use client";

// The merchant's three setup steps on a signed-out dashboard page, each with a live status: (1) a wallet in this
// browser, (2) Whitechain Testnet added to it (optional for sign-in, needed for invoices and refunds), (3) "Sign in
// with your wallet" (SIWE): sign one message (free, moves no money) and the server sets a session cookie. Customers
// never see this; they pay with the guest wallet. Nothing here asks the wallet for anything until a button is pressed.
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createWalletClient, custom } from "viem";
import { whitechainSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";
import { Button } from "@/components/Button";
import { SIGN_IN_WINDOW_MS, WHITECHAIN_TESTNET, signInProblem, walletProblem } from "@/lib/onboarding";
import { privyAppId, walletConnectProjectId } from "@/lib/privy-config";
// window.ethereum's type lives in lib/window-ethereum.d.ts (batch 051)

const NO_ACCOUNT = "Your wallet didn't share an account. Unlock it, pick an account, then try again.";
const OFFLINE = "We couldn't reach our server. Check your connection, then try again.";

/** A sign-in failure already worded for the merchant. */
class Problem extends Error {}

// Whether this browser has a wallet: null on the server and during hydration (not checked yet). MetaMask's mobile
// browser can inject window.ethereum after the page loads and says so with this event.
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

/** The wallet's current chain id (eth_chainId asks the user nothing), kept current by chainChanged. */
function useChainId(found: boolean | null): [number | null, (id: number | null) => void] {
  const [chainId, setChainId] = useState<number | null>(null);
  useEffect(() => {
    const provider = window.ethereum;
    if (!found || !provider) return;
    let live = true;
    const update = (id: unknown) => live && setChainId(typeof id === "string" || typeof id === "number" ? Number(id) : null);
    provider.request({ method: "eth_chainId" }).then(update, () => update(null));
    provider.on?.("chainChanged", update);
    return () => {
      live = false;
      provider.removeListener?.("chainChanged", update);
    };
  }, [found]);
  return [chainId, setChainId];
}

type Tone = "done" | "todo" | "busy";
const TONE: Record<Tone, string> = { done: "text-positive", todo: "text-ink-muted", busy: "text-accent" };

function Step({ n, title, status, tone, children }: { n: number; title: string; status: string; tone: Tone; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-4 py-5 first:pt-1">
      <span aria-hidden="true" className={`data grid size-8 place-items-center rounded-full border ${tone === "done" ? "border-current text-positive" : "border-hairline text-ink-muted"}`}>
        {tone === "done" ? "✓" : n}
      </span>
      <div className="grid min-w-0 gap-2.5">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h3 className="text-[17px] font-medium tracking-[-0.01em]">{title}</h3>
          <span role="status" className={`eyebrow rounded-pill border border-current px-2.5 py-0.5 ${TONE[tone]}`}>
            <span className="sr-only">{title}: </span>
            {status}
          </span>
        </div>
        {children}
      </div>
    </li>
  );
}

const secondary = "h-11 cursor-pointer justify-self-start rounded-pill border border-current px-5 text-sm font-medium text-accent hover:bg-accent-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-45";
const help = "text-sm text-ink-muted";
const alert = (message: string | null) =>
  message && (
    <p role="alert" className="text-sm text-critical">
      {message}
    </p>
  );

export function SignIn({ available }: { available: boolean }) {
  const router = useRouter();
  const found = useHasWallet();
  const [chainId, setChainId] = useChainId(found);
  const [busy, setBusy] = useState<"network" | "sign" | "privy" | null>(null);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const onWhitechain = chainId === whitechainSepolia.id;
  const privy = privyAppId();

  async function addNetwork() {
    const provider = window.ethereum;
    if (!provider) return;
    setNetworkError(null);
    setBusy("network");
    try {
      await provider.request({ method: "wallet_addEthereumChain", params: [WHITECHAIN_TESTNET] });
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: WHITECHAIN_TESTNET.chainId }] });
      setChainId(Number(await provider.request({ method: "eth_chainId" })));
    } catch (e) {
      setNetworkError(walletProblem(e, "network"));
    } finally {
      setBusy(null);
    }
  }

  async function signIn() {
    const provider = window.ethereum;
    setError(null);
    if (!provider) return;
    setBusy("sign");
    try {
      const wallet = createWalletClient({ chain: whitechainSepolia, transport: custom(provider) });
      const [address] = await wallet.requestAddresses();
      if (!address) throw new Problem(NO_ACCOUNT);
      const asked = Date.now();
      const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" }).catch(() => {
        throw new Problem(OFFLINE);
      });
      const { nonce, error: nonceError } = (await nonceRes.json().catch(() => ({}))) as { nonce?: string; error?: string };
      if (!nonceRes.ok || !nonce) throw new Problem(signInProblem(nonceRes.status, nonceError, Date.now() - asked));
      const message = createSiweMessage({
        address,
        chainId: whitechainSepolia.id,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: "1",
        expirationTime: new Date(Date.now() + SIGN_IN_WINDOW_MS), // the server refuses messages without a short expiry
        statement: "Sign in to your WhiteFlow dashboard. This is free and moves no money.",
      });
      const signature = await wallet.signMessage({ account: address, message });
      const res = await fetch("/api/auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message, signature }) }).catch(() => {
        throw new Problem(OFFLINE);
      });
      if (!res.ok) throw new Problem(signInProblem(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error, Date.now() - asked));
      setSignedIn(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Problem ? e.message : walletProblem(e, "sign"));
    } finally {
      setBusy(null);
    }
  }

  async function signInWithPrivy() {
    setError(null);
    const appId = privyAppId();
    if (!appId) return;
    setBusy("privy");
    try {
      const wcId = walletConnectProjectId();
      const { openPrivy } = await import("@/components/PrivyPay");
      const session = await openPrivy(appId, wcId, "Sign in to WhiteFlow");
      try {
        const provider = await session.wallet.getEthereumProvider();
        const wallet = createWalletClient({ chain: whitechainSepolia, transport: custom(provider) });
        const [address] = await wallet.requestAddresses();
        if (!address) throw new Problem(NO_ACCOUNT);
        const asked = Date.now();
        const nonceRes = await fetch("/api/auth/nonce", { cache: "no-store" }).catch(() => {
          throw new Problem(OFFLINE);
        });
        const { nonce, error: nonceError } = (await nonceRes.json().catch(() => ({}))) as { nonce?: string; error?: string };
        if (!nonceRes.ok || !nonce) throw new Problem(signInProblem(nonceRes.status, nonceError, Date.now() - asked));
        const message = createSiweMessage({
          address,
          chainId: whitechainSepolia.id,
          domain: window.location.host,
          nonce,
          uri: window.location.origin,
          version: "1",
          expirationTime: new Date(Date.now() + SIGN_IN_WINDOW_MS),
          statement: "Sign in to your Merchant Capital+ dashboard. This is free and moves no money.",
        });
        const signature = await wallet.signMessage({ account: address, message });
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, signature }),
        }).catch(() => {
          throw new Problem(OFFLINE);
        });
        if (!res.ok) throw new Problem(signInProblem(res.status, ((await res.json().catch(() => ({}))) as { error?: string }).error, Date.now() - asked));
        setSignedIn(true);
        router.refresh();
      } finally {
        await session.close().catch(() => undefined);
      }
    } catch (e) {
      setError(e instanceof Problem ? e.message : walletProblem(e, "sign"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <ol className="grid divide-y divide-hairline">
      <Step n={1} title="A wallet" status={found === null ? "Checking" : found ? "Found" : privy ? "Privy ready" : "Not found"} tone={found || privy ? "done" : "todo"}>
        {found === null ? (
          <p className={help}>Looking for a wallet in this browser…</p>
        ) : found ? (
          <p className={help}>There&apos;s a wallet in this browser. Use the account you want your shop paid to, or sign in with Privy.</p>
        ) : privy ? (
          <>
            <p className={help}>No wallet extension? Onboard instantly with Privy using email or any mobile wallet (WalletConnect / QR).</p>
            <button type="button" className={`${secondary} inline-flex items-center gap-1.5`} onClick={signInWithPrivy} aria-disabled={busy !== null || signedIn}>
              {busy === "privy" ? "Opening Privy…" : "Onboard with Privy"}
            </button>
          </>
        ) : (
          <>
            <p className={help}>No wallet in this browser yet. On a computer, install MetaMask, then reload this page.</p>
            <a href="https://metamask.io/download/" target="_blank" rel="noreferrer" className={`${secondary} inline-flex items-center gap-1.5`}>
              Install MetaMask <span aria-hidden="true">↗</span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <p className={help}>On a phone, open this page in your wallet app&apos;s own browser.</p>
          </>
        )}
      </Step>

      <Step n={2} title="Add Whitechain Testnet" status={onWhitechain ? "Added" : busy === "network" ? "Waiting" : "Not yet"} tone={onWhitechain ? "done" : busy === "network" ? "busy" : "todo"}>
        <p className={help}>Optional for sign-in. You need it later to send invoices and refunds.</p>
        {onWhitechain ? (
          <p className="text-sm">Your wallet is on Whitechain Testnet (chain 1874).</p>
        ) : (
          <button type="button" className={secondary} aria-disabled={!found || busy !== null} onClick={found && busy === null ? addNetwork : undefined}>
            {busy === "network" ? "Check your wallet…" : "Add Whitechain Testnet"}
          </button>
        )}
        {alert(networkError)}
      </Step>

      <Step
        n={3}
        title="Sign in"
        status={signedIn ? "Signed in" : busy === "sign" || busy === "privy" ? "Waiting" : "Signed out"}
        tone={signedIn ? "done" : busy === "sign" || busy === "privy" ? "busy" : "todo"}
      >
        <p className={help}>Use the wallet your shop gets paid to. You sign one message. It&apos;s free and moves no money.</p>
        {available ? (
          <div className="flex flex-wrap items-center gap-3">
            {found && (
              <Button onClick={signIn} aria-disabled={busy !== null || signedIn} className="justify-self-start">
                {busy === "sign" ? "Check your wallet…" : signedIn ? "Opening your dashboard…" : "Sign in with your wallet"}
              </Button>
            )}
            {privy && (found ? (
              <button
                type="button"
                className={secondary}
                onClick={signInWithPrivy}
                aria-disabled={busy !== null || signedIn}
              >
                {busy === "privy" ? "Opening Privy…" : signedIn ? "Opening your dashboard…" : "Sign in with Privy"}
              </button>
            ) : (
              <Button
                variant="primary"
                onClick={signInWithPrivy}
                aria-disabled={busy !== null || signedIn}
                className="justify-self-start"
              >
                {busy === "privy" ? "Opening Privy…" : signedIn ? "Opening your dashboard…" : "Sign in with Privy"}
              </Button>
            ))}
            {!found && !privy && (
              <Button onClick={signIn} aria-disabled={true} className="justify-self-start">
                Sign in with your wallet
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-warning">Sign-in isn&apos;t set up on this server yet.</p>
        )}
        {alert(error)}
      </Step>
    </ol>
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
