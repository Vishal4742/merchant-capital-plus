"use client";
// Settings → Workspace (batch 050, SRS FR-BIZ-1..5): the signed-in person's workspace, team and receiving wallet, on the
// v2 API. Every rule is enforced by the server; this screen only shows what the role may do and why not otherwise.
// Signatures use the browser wallet (EIP-1193) directly: Privy is not loaded on the dashboard. The receiving wallet signs
// a proof of control; then a wallet Privy verified for the Owner signs the approval; a confirmation screen shows the full
// address, network and exact token before anything is activated (FR-BIZ-4).
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, getAddress, type Address, type EIP1193Provider } from "viem";
import { CopyButton } from "@/components/CopyButton";
import { card, field, textLink } from "@/components/gateway/Frame";
import { StatusBadge } from "@/components/ui/Badge";
import { walletError } from "@/lib/merchant-wallet";
import { EXPLORER } from "@/lib/usdt";

type Role = "owner" | "operator" | "viewer";
interface Me {
  principal: { id: string; email: string | null; wallets: string[] };
  businesses: { id: string; displayName: string; timezone: string; role: Role }[];
  active: { id: string; role: Role } | null;
}
interface Member { principalId: string; email: string | null; wallets: string[]; role: Role; since: number }
interface Policy { version: number; chainId: number; token: string; recipient: string; policyHash: string; approvalWallet: string; v1Obligations: boolean; approvedAt: number }
interface Proof { nonce: string; message: string; recipient: string; version: number; policyHash: string; token: string; chainId: number }

const primary =
  "h-11 cursor-pointer rounded-pill bg-accent px-5 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const secondary =
  "h-11 cursor-pointer rounded-pill border border-current px-5 text-sm font-medium text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", operator: "Operator", viewer: "Viewer" };
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? "GET",
    credentials: "same-origin",
    headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Something went wrong. Try again.");
  return body;
}
const message = (e: unknown) => (e instanceof ApiError ? e.message : walletError(e));

function wallet(): EIP1193Provider | null {
  return typeof window === "undefined" ? null : ((window as unknown as { ethereum?: EIP1193Provider }).ethereum ?? null);
}
async function sign(address: string, text: string): Promise<`0x${string}`> {
  const provider = wallet();
  if (!provider) throw new Error("No browser wallet found. Install or open one, then try again.");
  const client = createWalletClient({ transport: custom(provider) });
  const accounts = (await client.requestAddresses()).map((a) => a.toLowerCase());
  if (!accounts.includes(address.toLowerCase())) {
    throw new Error(`Switch your wallet to ${short(getAddress(address))} first: this step must be signed by that wallet.`);
  }
  return client.signMessage({ account: getAddress(address) as Address, message: text });
}

export function WorkspaceSettings() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signed-out" | "down">("loading");
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api<Me>("/api/v2/me").then(
        (m) => {
          setMe(m);
          setState("ready");
        },
        (e: unknown) => {
          if (e instanceof ApiError && e.status === 401) return setState("signed-out");
          setState("down");
          setProblem(message(e));
        },
      ),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const signOut = async () => {
    await api("/api/v2/auth/signout", { method: "POST" }).catch(() => undefined);
    // a full load on purpose: /sign-in sends its own CSP (with Privy) and ends Privy's session there (?out=1)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/sign-in?out=1");
  };

  if (state === "loading") return <section className={card} aria-busy="true"><p className="text-sm text-ink-muted">Loading your workspace…</p></section>;
  if (state === "signed-out") {
    return (
      <section aria-labelledby="ws-heading" className={card}>
        <h2 id="ws-heading" className="text-[17px] font-semibold text-ink">Workspace</h2>
        <p className="text-sm text-ink-muted">You&apos;re not signed in to a WhiteFlow workspace, or your session ended.</p>
        <a href="/sign-in" className={textLink}>Sign in with email or wallet</a>
      </section>
    );
  }
  if (state === "down" || !me) {
    return (
      <section className={card}>
        <p role="alert" className="text-sm text-critical">{problem ?? "We couldn't load your workspace. Try again in a minute."}</p>
        <button type="button" className={secondary} onClick={() => void load()}>Try again</button>
      </section>
    );
  }

  const active = me.active ? me.businesses.find((b) => b.id === me.active?.id) : undefined;
  return (
    <div className="grid gap-6">
      <section aria-labelledby="ws-heading" className={card}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="ws-heading" className="text-[17px] font-semibold text-ink">Workspace</h2>
          <button type="button" className={secondary} onClick={() => void signOut()}>Sign out</button>
        </div>
        <p className="text-sm text-ink-muted">
          Signed in as <span className="font-medium text-ink break-all">{me.principal.email ?? (me.principal.wallets[0] ? short(me.principal.wallets[0]) : "your Privy account")}</span>
          {me.principal.wallets.length > 0 && <> · approval {me.principal.wallets.length === 1 ? "wallet" : "wallets"} {me.principal.wallets.map(short).join(", ")}</>}
        </p>
        {active ? (
          <WorkspaceSwitch me={me} active={active} onChange={load} />
        ) : (
          <CreateWorkspace onCreated={load} hasOthers={me.businesses.length > 0} />
        )}
      </section>
      {active && (
        <>
          <ReceivingWallet role={active.role} principalWallets={me.principal.wallets} />
          <Team role={active.role} selfId={me.principal.id} />
        </>
      )}
    </div>
  );
}

function WorkspaceSwitch({ me, active, onChange }: { me: Me; active: Me["businesses"][number]; onChange: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{active.displayName}</span>
        <StatusBadge status={active.role === "owner" ? "paid" : "neutral"} label={ROLE_LABEL[active.role]} />
        <span className="text-xs text-ink-muted">{active.timezone}</span>
      </div>
      {me.businesses.length > 1 && (
        <label className="grid max-w-sm gap-1 text-sm">
          <span className="eyebrow text-ink-muted">Switch workspace</span>
          <select
            className={field}
            value={active.id}
            onChange={(e) => {
              setError(null);
              api("/api/v2/me/active-business", { method: "POST", body: { businessId: e.target.value } }).then(onChange, (err) => setError(message(err)));
            }}
          >
            {me.businesses.map((b) => <option key={b.id} value={b.id}>{b.displayName} ({ROLE_LABEL[b.role]})</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    </div>
  );
}

function CreateWorkspace({ onCreated, hasOthers }: { onCreated: () => Promise<void>; hasOthers: boolean }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/v2/businesses", { method: "POST", body: { displayName: name.trim(), timezone, idempotencyKey: key } });
      await onCreated();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3" aria-labelledby="create-ws">
      <p id="create-ws" className="text-sm text-ink-muted">
        {hasOthers ? "Choose a workspace above, or create another." : "Create your business workspace. You can draft invoices right away; collection starts once an Owner approves a receiving wallet."}
      </p>
      <label className="grid gap-1 text-sm">
        <span className="eyebrow text-ink-muted">Business name</span>
        <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoComplete="organization" />
      </label>
      <label className="grid gap-1 text-sm">
        <span className="eyebrow text-ink-muted">Time zone (for due dates and reports)</span>
        <input className={field} value={timezone} onChange={(e) => setTimezone(e.target.value)} maxLength={64} required />
      </label>
      <button type="submit" className={`${primary} justify-self-start`} disabled={busy || name.trim().length === 0}>
        {busy ? "Creating…" : "Create workspace"}
      </button>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    </form>
  );
}

function ReceivingWallet({ role, principalWallets }: { role: Role; principalWallets: string[] }) {
  const [current, setCurrent] = useState<Policy | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"idle" | "proof" | "approval" | "confirm" | "busy">("idle");
  const [recipient, setRecipient] = useState("");
  const [approver, setApprover] = useState(principalWallets[0] ?? "");
  const [proof, setProof] = useState<Proof | null>(null);
  const [signed, setSigned] = useState<{ proofSignature: string; approvalNonce: string; approvalSignature: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const owner = role === "owner";

  const load = useCallback(
    () => api<{ current: Policy | null }>("/api/v2/business/policy").then((r) => setCurrent(r.current), (e: unknown) => setError(message(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const fillFromWallet = async () => {
    setError(null);
    const provider = wallet();
    if (!provider) return setError("No browser wallet found. Install or open one, or type the address.");
    try {
      const [first] = await createWalletClient({ transport: custom(provider) }).requestAddresses();
      if (first) setRecipient(first);
    } catch (e) {
      setError(walletError(e));
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
      setStep((s) => (s === "busy" ? "idle" : s));
    }
  };
  const signProof = () =>
    run(async () => {
      const p = await api<Proof>("/api/v2/business/policy/proof", { method: "POST", body: { address: recipient.trim() } });
      setProof(p);
      setStep("proof");
      const proofSignature = await sign(p.recipient, p.message);
      setSigned({ proofSignature, approvalNonce: "", approvalSignature: "" });
      setStep("approval");
    });
  const signApproval = () =>
    run(async () => {
      if (!proof || !signed) return;
      const a = await api<{ nonce: string; message: string }>("/api/v2/business/policy/approval", { method: "POST", body: { proofNonce: proof.nonce, wallet: approver } });
      const approvalSignature = await sign(approver, a.message);
      setSigned({ ...signed, approvalNonce: a.nonce, approvalSignature });
      setStep("confirm");
    });
  const activate = () =>
    run(async () => {
      if (!proof || !signed) return;
      setStep("busy");
      const policy = await api<Policy>("/api/v2/business/policy", {
        method: "POST",
        body: { proofNonce: proof.nonce, proofSignature: signed.proofSignature, approvalNonce: signed.approvalNonce, approvalSignature: signed.approvalSignature, expectedCurrentVersion: current?.version ?? 0 },
      });
      setCurrent(policy);
      setProof(null);
      setSigned(null);
      setConfirmed(false);
      setStep("idle");
    });

  return (
    <section aria-labelledby="rw-heading" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="rw-heading" className="text-[17px] font-semibold text-ink">Receiving wallet</h2>
        {current ? <StatusBadge status="paid" label={`Version ${current.version} active`} /> : current === null ? <StatusBadge status="warning" label="Not set: collection off" /> : null}
      </div>
      {current === undefined && !error && <p className="text-sm text-ink-muted">Loading…</p>}
      {current && <PolicyFacts policy={current} />}
      {current === null && (
        <p className="text-sm text-ink-muted">Payments start only after an Owner approves where they go. Approving moves no funds.</p>
      )}
      {!owner && (
        <p className="text-sm text-ink-muted">
          <button type="button" className={secondary} disabled aria-describedby="rw-why">Change receiving wallet</button>{" "}
          <span id="rw-why">Only an Owner can change where this workspace is paid.</span>
        </p>
      )}
      {owner && step === "idle" && (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm">
            <span className="eyebrow text-ink-muted">{current ? "New receiving wallet" : "Receiving wallet"} (Whitechain Testnet)</span>
            <input className={`${field} data`} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={secondary} onClick={() => void fillFromWallet()}>Use my connected wallet</button>
            <button type="button" className={primary} disabled={!/^0x[0-9a-fA-F]{40}$/.test(recipient.trim())} onClick={() => void signProof()}>
              Prove control of this wallet
            </button>
          </div>
          <p className="text-xs text-ink-muted">Step 1 of 3: the receiving wallet signs a message proving you control it. It is not a transaction.</p>
        </div>
      )}
      {owner && step === "proof" && <p className="text-sm text-ink-muted" role="status">Sign the proof in your wallet…</p>}
      {owner && step === "approval" && proof && (
        <div className="grid gap-3">
          <p className="text-sm text-ink">Wallet control confirmed for <span className="data break-all">{proof.recipient}</span>.</p>
          {principalWallets.length === 0 ? (
            <p className="text-sm text-critical" role="alert">
              To approve, link a wallet to your sign-in: <a className={textLink} href="/sign-in">sign in again</a> with a wallet, or add one in the Privy dialog.
            </p>
          ) : (
            <>
              <label className="grid gap-1 text-sm">
                <span className="eyebrow text-ink-muted">Approve with (a wallet linked to your sign-in)</span>
                <select className={`${field} data`} value={approver} onChange={(e) => setApprover(e.target.value)}>
                  {principalWallets.map((w) => <option key={w} value={w}>{getAddress(w)}</option>)}
                </select>
              </label>
              <button type="button" className={`${primary} justify-self-start`} onClick={() => void signApproval()}>Sign the approval</button>
              <p className="text-xs text-ink-muted">Step 2 of 3: your own wallet approves these exact terms (valid for 5 minutes).</p>
            </>
          )}
        </div>
      )}
      {owner && (step === "confirm" || step === "busy") && proof && (
        <div className="grid gap-3 rounded-[12px] border border-hairline bg-accent-soft p-4">
          <h3 className="font-medium text-ink">Step 3 of 3: confirm where this workspace is paid</h3>
          <dl className="grid gap-3 text-sm">
            <div className="grid gap-1">
              <dt className="eyebrow text-ink-muted">Pay out to</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <span className="data break-all text-ink">{proof.recipient}</span>
                <CopyButton text={proof.recipient} name="receiving wallet" />
                <a className={textLink} href={`${EXPLORER}/address/${proof.recipient}`} target="_blank" rel="noreferrer">View on explorer</a>
              </dd>
            </div>
            <div className="grid gap-1"><dt className="eyebrow text-ink-muted">Network</dt><dd className="text-ink">Whitechain Testnet (chain {proof.chainId})</dd></div>
            <div className="grid gap-1"><dt className="eyebrow text-ink-muted">Token</dt><dd className="data break-all text-ink">USDT {getAddress(proof.token)}</dd></div>
            <div className="grid gap-1"><dt className="eyebrow text-ink-muted">Policy</dt><dd className="data break-all text-ink-muted">version {proof.version} · {proof.policyHash}</dd></div>
          </dl>
          <p className="text-xs text-ink-muted">Invoices you already published keep the destination they were approved with. This changes where new invoices are paid.</p>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I confirm this is the full address, network and token where this workspace should be paid.</span>
          </label>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={primary} disabled={!confirmed || step === "busy"} onClick={() => void activate()}>
              {step === "busy" ? "Activating…" : "Activate receiving wallet"}
            </button>
            <button type="button" className={secondary} disabled={step === "busy"} onClick={() => { setStep("idle"); setProof(null); setSigned(null); setConfirmed(false); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    </section>
  );
}

function PolicyFacts({ policy }: { policy: Policy }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="grid min-w-0 gap-1 sm:col-span-2">
        <dt className="eyebrow text-ink-muted">Pay out to</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="data break-all text-ink">{getAddress(policy.recipient)}</span>
          <CopyButton text={getAddress(policy.recipient)} name="receiving wallet" />
          <a className={textLink} href={`${EXPLORER}/address/${policy.recipient}`} target="_blank" rel="noreferrer">View on explorer</a>
        </dd>
      </div>
      <div className="grid gap-1"><dt className="eyebrow text-ink-muted">Network</dt><dd className="text-ink">Whitechain Testnet (chain {policy.chainId})</dd></div>
      <div className="grid min-w-0 gap-1"><dt className="eyebrow text-ink-muted">Token</dt><dd className="data break-all text-ink">USDT {getAddress(policy.token)}</dd></div>
      <div className="grid gap-1"><dt className="eyebrow text-ink-muted">Status</dt><dd className="text-ink">Wallet control confirmed · approved {new Date(policy.approvedAt).toLocaleString()}</dd></div>
      <div className="grid min-w-0 gap-1"><dt className="eyebrow text-ink-muted">Approved with</dt><dd className="data break-all text-ink-muted">{getAddress(policy.approvalWallet)}</dd></div>
      {policy.v1Obligations && (
        <p className="text-xs text-ink-muted sm:col-span-2">This wallet has an existing Capital advance: it keeps collecting through the original payment contract, which repays investors.</p>
      )}
      <p className="text-xs text-ink-muted sm:col-span-2">“Wallet control confirmed” means the wallet signed our proof. It doesn&apos;t verify the business itself.</p>
    </dl>
  );
}

function Team({ role, selfId }: { role: Role; selfId: string }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState("");
  const [newRole, setNewRole] = useState<Role>("operator");
  const owner = role === "owner";
  const load = useCallback(
    () => api<{ members: Member[] }>("/api/v2/business/members").then((r) => setMembers(r.members), (e: unknown) => setError(message(e))),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(message(e));
    }
  };
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    const value = who.trim();
    const body = /^0x[0-9a-fA-F]{40}$/.test(value) ? { wallet: value } : { email: value };
    void act(() => api("/api/v2/business/members", { method: "POST", body: { ...body, role: newRole, idempotencyKey: crypto.randomUUID() } })).then(() => setWho(""));
  };
  return (
    <section aria-labelledby="team-heading" className={card}>
      <h2 id="team-heading" className="text-[17px] font-semibold text-ink">Team</h2>
      <p className="text-xs text-ink-muted">Owner: team, settings, receiving wallet. Operator: drafts invoices, inspects payments, prepares links and refund proposals. Viewer: reads only.</p>
      {members === null && !error && <p className="text-sm text-ink-muted">Loading…</p>}
      {members && (
        <ul className="grid divide-y divide-hairline">
          {members.map((m) => {
            // the last Owner can't be demoted or removed (the server refuses it too): say so instead of offering it
            const lastOwner = m.role === "owner" && members.filter((x) => x.role === "owner").length === 1;
            const locked = !owner || lastOwner;
            const why = !owner ? "Only an Owner can change roles." : lastOwner ? "A workspace needs at least one Owner. Make someone else an Owner first." : undefined;
            return (
            <li key={m.principalId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="grid min-w-0 gap-0.5">
                <span className="break-all text-sm text-ink">{m.email ?? (m.wallets[0] ? getAddress(m.wallets[0]) : "Privy account")}{m.principalId === selfId && " (you)"}</span>
                <span className="text-xs text-ink-muted">since {new Date(m.since).toLocaleDateString()}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`role-${m.principalId}`}>Role of {m.email ?? m.principalId}</label>
                <select
                  id={`role-${m.principalId}`}
                  className={`${field} h-10 w-auto`}
                  value={m.role}
                  disabled={locked}
                  title={why}
                  aria-describedby={lastOwner && owner ? `last-owner-${m.principalId}` : undefined}
                  onChange={(e) => void act(() => api(`/api/v2/business/members/${encodeURIComponent(m.principalId)}`, { method: "PATCH", body: { role: e.target.value, idempotencyKey: crypto.randomUUID() } }))}
                >
                  {(["owner", "operator", "viewer"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                {owner && lastOwner && (
                  <span id={`last-owner-${m.principalId}`} className="text-xs text-ink-muted">Last Owner: add another Owner before changing this role.</span>
                )}
                {owner && !lastOwner && (
                  <button
                    type="button"
                    className="min-h-10 cursor-pointer px-2 text-sm font-medium text-critical underline underline-offset-4"
                    onClick={() => void act(() => api(`/api/v2/business/members/${encodeURIComponent(m.principalId)}?idempotencyKey=${crypto.randomUUID()}`, { method: "DELETE" }))}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
            );
          })}
        </ul>
      )}
      {owner ? (
        <form onSubmit={add} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
          <label className="grid min-w-0 gap-1 text-sm">
            <span className="eyebrow text-ink-muted">Add by sign-in email or wallet</span>
            <input className={field} value={who} onChange={(e) => setWho(e.target.value)} placeholder="name@company.com or 0x…" autoComplete="off" required />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="eyebrow text-ink-muted">Role</span>
            <select className={field} value={newRole} onChange={(e) => setNewRole(e.target.value as Role)}>
              {(["operator", "viewer", "owner"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
          <button type="submit" className={primary} disabled={who.trim().length === 0}>Add</button>
          <p className="text-xs text-ink-muted sm:col-span-3">They need to have signed in to WhiteFlow once. No email is sent.</p>
        </form>
      ) : (
        <p className="text-sm text-ink-muted">Only an Owner can add, change or remove team members.</p>
      )}
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
    </section>
  );
}
