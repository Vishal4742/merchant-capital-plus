"use client";
// Batch 051 (SRS FR-BIZ-1, FR-BIZ-3 pattern, FR-AUTH-2): the dashboard's signed-out panel after the wallet-cookie
// cutover. The merchant dashboard opens for a WhiteFlow workspace that linked the legacy merchant wallet, so this panel
// walks the person there: sign in to WhiteFlow → a workspace → an Owner links the merchant wallet with one signature
// (no transaction, no funds). The server enforces every rule; this panel only reflects GET /api/v2/legacy.
// Styles are local on purpose: components/gateway/Frame.tsx renders this panel, so importing its tokens would be a cycle.
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, type EIP1193Provider } from "viem";

type Role = "owner" | "operator" | "viewer";
interface Status {
  workspace: { id: string; displayName: string; role: Role } | null;
  linked?: string | null;
}
type View = { kind: "loading" } | { kind: "signed-out" } | { kind: "down"; problem: string } | { kind: "ready"; status: Status };

const primary =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-pill bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover aria-disabled:cursor-not-allowed aria-disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const secondary =
  "inline-flex h-11 cursor-pointer items-center justify-center rounded-pill border border-current px-5 text-sm font-medium text-accent hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", operator: "Operator", viewer: "Viewer" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const USER_REJECTED = 4001; // EIP-1193
const REQUEST_PENDING = -32002; // MetaMask: a request of this kind is already open

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
/** A problem we found before asking the wallet anything (no wallet, no account): its message is for the person. */
class WalletSetup extends Error {}

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

/** One plain sentence for a failed link attempt. Linking only signs a message, so no wording about fees or funds. */
function linkProblem(e: unknown): string {
  if (e instanceof ApiError || e instanceof WalletSetup) return e.message;
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  if (code === USER_REJECTED) return "You cancelled in your wallet. Nothing was signed and nothing was linked.";
  if (code === REQUEST_PENDING) return "Your wallet already has a request open. Open the wallet, finish or close it, then try again.";
  return "Your wallet couldn't sign the link message. Nothing was linked. Try again.";
}

function browserWallet(): EIP1193Provider | null {
  return typeof window === "undefined" ? null : ((window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null);
}

/** Wallet → challenge → one signature → claim. Returns the linked address. */
async function linkMerchantWallet(onStep: (step: string) => void): Promise<string> {
  const provider = browserWallet();
  if (!provider) throw new WalletSetup("No browser wallet found. Open the wallet your merchant account uses, then try again.");
  const client = createWalletClient({ transport: custom(provider) });
  onStep("Choose the merchant wallet in your wallet…");
  const [account] = await client.requestAddresses();
  if (!account) throw new WalletSetup("Your wallet didn't share an account. Unlock it, pick the merchant account, then try again.");
  const challenge = await api<{ nonce: string; message: string }>("/api/v2/legacy/challenge", { address: account });
  onStep(`Sign the link message with ${short(account)}. It's free and moves no funds.`);
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

  const busy = step !== null;
  const link = async () => {
    if (busy) return; // aria-disabled keeps focus on the button, so a second press is ignored here
    setProblem(null);
    try {
      await linkMerchantWallet(setStep);
      window.location.reload();
    } catch (e) {
      setStep(null);
      setProblem(linkProblem(e));
      if (e instanceof ApiError && e.status === 409) void load(); // e.g. linked meanwhile in another tab: show what is true now
    }
  };

  if (view.kind === "loading") return <p className="text-sm text-ink-muted">Checking your WhiteFlow sign-in…</p>;
  if (view.kind === "signed-out") {
    return (
      <div className="grid gap-3">
        <p className="text-sm text-ink-muted">Sign in to WhiteFlow with your email or wallet. If you used this dashboard with a merchant wallet before, you&apos;ll link it next.</p>
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
        {workspace.displayName} isn&apos;t linked to a merchant wallet yet. You&apos;re a {ROLE_LABEL[workspace.role]}: ask an Owner to link it.
      </p>
    );
  }
  return (
    <div className="grid gap-3">
      <p className="text-sm text-ink-muted">
        Used this dashboard with a merchant wallet before? Link that wallet to {workspace.displayName}: its links, pages, vouchers, keys, webhooks and
        payments then belong to this workspace, managed by role. You sign one message. There&apos;s no transaction and no funds move.
      </p>
      <button type="button" className={primary} aria-disabled={busy} onClick={() => void link()}>
        {busy ? "Linking…" : "Link merchant wallet"}
      </button>
      <p className="text-xs text-ink-muted" role="status" aria-live="polite">
        {step ?? ""}
      </p>
      {problem && (
        <p className="text-sm text-critical" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Signs out of WhiteFlow: the server revokes the session, then /sign-in?out=1 ends Privy's session in this browser.
 *  If the server can't confirm the sign-out, the session may still be live: say so and stay. */
export function WorkspaceSignOut() {
  const [problem, setProblem] = useState<string | null>(null);
  const signOut = async () => {
    setProblem(null);
    try {
      await api("/api/v2/auth/signout", {});
    } catch {
      setProblem("We couldn't sign you out. Try again.");
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in?out=1");
  };
  return (
    <span className="inline-flex items-center gap-2">
      {problem && (
        <span className="text-xs text-critical" role="alert">
          {problem}
        </span>
      )}
      <button
        type="button"
        className="inline-flex min-h-10 cursor-pointer items-center px-1 text-xs font-medium text-accent underline underline-offset-4 hover:text-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        onClick={() => void signOut()}
      >
        Sign out
      </button>
    </span>
  );
}
