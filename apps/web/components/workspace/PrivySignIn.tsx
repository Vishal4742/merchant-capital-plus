"use client";
// Business sign-in (batch 050, SRS FR-BIZ-6 v3.1): the only screen that loads Privy (its CSP allows Privy; the dashboard,
// checkout and receipts don't). Privy signs the person in with email or an existing external wallet on Whitechain
// Testnet; no embedded wallet is ever created for a business. After an explicit press, Privy's access token and identity
// token are exchanged once for a Whiteflow session (POST /api/v2/auth/privy); the server verifies both. A Privy session
// left in this browser is never used silently, and signing out of Whiteflow (?out=1) ends Privy's session here too.
import { PrivyProvider, useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { whitechainTestnet } from "@/lib/privy-config";
import { clearPrivyStorage } from "@/lib/privy-session";

/** PrivyProvider's config for businesses: email or an external wallet, chain 1874 only, embedded wallets off. */
export function businessPrivyConfig(wcProjectId: string | null) {
  return {
    loginMethods: ["email", "wallet"] as ("email" | "wallet")[],
    supportedChains: [whitechainTestnet],
    defaultChain: whitechainTestnet,
    embeddedWallets: { ethereum: { createOnLogin: "off" as const } },
    appearance: {
      walletChainType: "ethereum-only" as const,
      walletList: ["detected_ethereum_wallets", "metamask", "rainbow", "wallet_connect"] as ("detected_ethereum_wallets" | "metamask" | "rainbow" | "wallet_connect")[],
      landingHeader: "Sign in to Whiteflow",
      showWalletLoginFirst: false,
    },
    legal: { privacyPolicyUrl: "/docs" },
    ...(wcProjectId ? { walletConnectCloudProjectId: wcProjectId } : {}),
  };
}

const primary =
  "h-11 cursor-pointer rounded-pill bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const secondary =
  "h-11 cursor-pointer rounded-pill border border-current px-5 text-sm font-medium text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const NO_IDENTITY_TOKEN =
  "Privy signed you in but didn't return an identity token, so Whiteflow can't confirm your email or wallets. The owner needs to turn on “Return user data in an identity token” in the Privy dashboard.";

function Flow() {
  const { ready, authenticated, login, logout, getAccessToken, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const [wanted, setWanted] = useState(false); // the person pressed Continue on this page
  const [error, setError] = useState<string | null>(null);
  // ?out=1: Whiteflow just signed out; Privy's session in this browser ends too before anything else (read once)
  const [cleared, setCleared] = useState(() => typeof window === "undefined" || new URLSearchParams(window.location.search).get("out") !== "1");
  const sent = useRef(false);
  const busy = wanted && authenticated && error === null;

  useEffect(() => {
    if (!ready || cleared) return;
    (authenticated ? logout() : Promise.resolve())
      .catch(() => undefined)
      .finally(() => {
        clearPrivyStorage(window.localStorage);
        setCleared(true);
      });
  }, [ready, cleared, authenticated, logout]);

  // exchange once, only after the press, once Privy has both tokens
  useEffect(() => {
    if (!wanted || !ready || !authenticated || sent.current) return;
    if (!identityToken) {
      const t = setTimeout(() => !sent.current && setError(NO_IDENTITY_TOKEN), 8_000);
      return () => clearTimeout(t);
    }
    sent.current = true;
    getAccessToken()
      .then(async (access) => {
        if (!access) throw new Error("Privy didn't give an access token. Try again.");
        const res = await fetch("/api/v2/auth/privy", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", authorization: `Bearer ${access}` },
          body: JSON.stringify({ idToken: identityToken }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? "We couldn't sign you in. Try again.");
        }
        // a full load on purpose: the dashboard sends its own CSP, without Privy (security review 005 F-N4)
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/merchant/settings");
      })
      .catch((e: unknown) => {
        sent.current = false;
        setWanted(false);
        setError(e instanceof Error ? e.message : "We couldn't sign you in. Try again.");
      });
  }, [wanted, ready, authenticated, identityToken, getAccessToken]);

  const start = () => {
    setError(null);
    setWanted(true);
    if (!authenticated) login();
  };
  const switchAccount = async () => {
    setError(null);
    await logout().catch(() => undefined);
    clearPrivyStorage(window.localStorage);
  };

  if (!ready || !cleared) return <p className="text-sm text-ink-muted">Loading sign-in…</p>;
  const who = user?.email?.address ?? user?.wallet?.address;
  return (
    <div className="grid gap-4">
      {authenticated && who && !busy && (
        <p className="text-sm text-ink-muted">
          Privy has you signed in as <span className="font-medium text-ink break-all">{who}</span> in this browser.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="button" className={primary} disabled={busy} onClick={start}>
          {busy ? "Signing you in…" : authenticated ? "Continue to Whiteflow" : "Continue with email or wallet"}
        </button>
        {authenticated && !busy && (
          <button type="button" className={secondary} onClick={() => void switchAccount()}>
            Use another account
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
    </div>
  );
}

export function PrivySignIn({ appId, wcProjectId }: { appId: string; wcProjectId: string | null }) {
  return (
    <PrivyProvider appId={appId} config={businessPrivyConfig(wcProjectId)}>
      <Flow />
    </PrivyProvider>
  );
}
