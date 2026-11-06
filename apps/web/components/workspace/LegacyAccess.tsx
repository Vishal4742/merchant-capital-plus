"use client";
// Batch 051 (SRS FR-BIZ-1, FR-BIZ-3 pattern, FR-AUTH-2): the dashboard's signed-out panel after the wallet-cookie
// cutover. The merchant dashboard opens for a WhiteFlow workspace that linked the legacy merchant wallet, so this panel
// walks the person there: sign in to WhiteFlow → a workspace → an Owner links the merchant wallet with one signature
// (no transaction, no funds). The server enforces every rule; this panel only reflects GET /api/v2/legacy.
// Styles are local on purpose: components/gateway/Frame.tsx renders this panel, so importing its tokens would be a cycle.
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";
import { walletError } from "@/lib/merchant-wallet";

type Role = "owner" | "operator" | "viewer";
interface Status {
  workspace: { id: string; displayName: string; role: Role } | null;
  linked?: string | null;
}
type View = { kind: "loading" } | { kind: "signed-out" } | { kind: "down"; problem: string } | { kind: "ready"; status: Status };

const primary =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const secondary =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-pill border border-current px-5 text-sm font-medium text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", operator: "Operator", viewer: "Viewer" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, json.error ?? "Something went wrong. Try again.");
  return json;
}

function browserWallet(): EIP1193Provider | null {
  return typeof window === "undefined" ? null : ((window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null);
}

/** Wallet → challenge → one signature → claim. Returns the linked address. */
async function linkMerchantWallet(onStep: (step: string) => void): Promise<string> {
  const provider = browserWallet();
  if (!provider) throw new Error("No browser wallet found. Open the wallet your merchant account uses, then try again.");
  const client = createWalletClient({ transport: custom(provider) });
  onStep("Choose the merchant wallet in your wallet…");
  const [account] = await client.requestAddresses();
  if (!account) throw new Error("Your wallet didn't share an account. Unlock it, pick the merchant account, then try again.");
  const challenge = await api<{ nonce: string; message: string }>("/api/v2/legacy/challenge", { address: account });
  onStep(`Sign the link message with ${short(account)} (free, moves no funds)…`);
  const signature = await client.signMessage({ account, message: challenge.message });
  onStep("Linking…");
  const done = await api<{ merchant: string }>("/api/v2/legacy/claim", { nonce: challenge.nonce, signature });
  return done.merchant;
}

/** The signed-out / not-linked panel on every dashboard page. */
export function LegacyAccess() {
  const [view, setView] = useState<View>({ kind: "loading" });
  const [step, setStep] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Status>("/api/v2/legacy").then(
        (status) => setView({ kind: "ready", status }),
        (e: unknown) => setView(e instanceof ApiError && e.status === 401 ? { kind: "signed-out" } : { kind: "down", problem: e instanceof ApiError ? e.message : "We couldn't reach WhiteFlow. Check your connection, then try again." }),
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const link = async () => {
    setProblem(null);
    try {
      await linkMerchantWallet(setStep);
      window.location.reload();
    } catch (e) {
      setStep(null);
      setProblem(e instanceof ApiError ? e.message : walletError(e));
    }
  };

  if (view.kind === "loading") return <p className="text-sm text-ink-muted">Checking your WhiteFlow sign-in…</p>;
  if (view.kind === "signed-out") {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-ink-muted">Sign in to WhiteFlow with your email or wallet. Then link the wallet your merchant account uses.</p>
        {/* a full load on purpose: /sign-in sends its own CSP (with Privy) */}
        <a href="/sign-in" className={primary}>
          Sign in to WhiteFlow
        </a>
      </div>
    );
  }
  if (view.kind === "down") {
    return (
      <div className="grid gap-3" role="alert">
        <p className="text-sm text-ink">{view.problem}</p>
        <button type="button" className={secondary} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  const { workspace, linked } = view.status;
  if (!workspace) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-ink-muted">You&apos;re signed in. Create your workspace first, then link your merchant wallet to it.</p>
        <a href="/merchant/settings" className={primary}>
          Create your workspace
        </a>
      </div>
    );
  }
  if (linked) {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-ink-muted">
          {workspace.displayName} is linked to <span className="font-mono">{short(linked)}</span>.
        </p>
        <button type="button" className={primary} onClick={() => window.location.reload()}>
          Open the dashboard
        </button>
      </div>
    );
  }
  if (workspace.role !== "owner") {
    return (
      <p className="text-sm text-ink-muted">
        {workspace.displayName} isn&apos;t linked to a merchant account yet. You&apos;re a {ROLE_LABEL[workspace.role]}: ask an Owner to link it.
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-muted">
        Link your existing merchant wallet to {workspace.displayName}. Its links, pages, vouchers, keys, webhooks and payments move into this workspace,
        managed by role. You sign one message: no transaction, no funds move.
      </p>
      <button type="button" className={primary} disabled={step !== null} onClick={() => void link()}>
        {step === null ? "Link merchant wallet" : "Linking…"}
      </button>
      {step && (
        <p className="text-xs text-ink-muted" aria-live="polite">
          {step}
        </p>
      )}
      {problem && (
        <p className="text-sm text-critical" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Signs out of WhiteFlow: the server revokes the session, then /sign-in?out=1 ends Privy's session in this browser. */
export function WorkspaceSignOut() {
  const signOut = async () => {
    await api("/api/v2/auth/signout", {}).catch(() => undefined);
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in?out=1");
  };
  return (
    <button type="button" className="text-xs font-medium text-accent underline underline-offset-4 hover:text-accent-hover cursor-pointer" onClick={() => void signOut()}>
      Sign out
    </button>
  );
}
