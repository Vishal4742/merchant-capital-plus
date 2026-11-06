// SANDBOX ONLY (batch 052, FR-MCP-16): the local simulator's state file. Nothing here talks to a network or moves
// money. It holds simulated merchants, sandbox API keys (only their sha256), customers, links, invoices, simulated
// payments, idempotency slots and processed provider events, in one JSON file guarded by src/state.ts.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Scope } from "../contract.ts";
import { snapshot, transact } from "../state.ts";

export const ALL_SCOPES: Scope[] = ["account:read", "customers:read", "customers:write", "links:read", "links:write", "invoices:read", "invoices:write", "payments:read", "reports:read"];
export const SANDBOX_KEY = /^wf_sbx_[A-Za-z0-9_-]{32}$/;

export interface SMerchant {
  id: string;
  name: string;
  timezone: string;
  next_number: number; // WF-<n> for the next finalized invoice
  /** Human decision 2026-11-07: an Owner approves each publication on the review page (sandbox: the CLI's approve). */
  publish_policy: "owner_approval";
}
export interface SKey {
  id: string;
  merchant_id: string;
  hash: string;
  label: string;
  scopes: Scope[];
  expires_at: number | null;
  revoked_at: number | null;
}
export interface SCustomer {
  id: string;
  merchant_id: string;
  name: string;
  email: string | null;
  created_at: number;
}
export interface SLink {
  id: string;
  merchant_id: string;
  slug: string;
  amount: string | null; // minor units of `currency`
  currency: string;
  description: string;
  reference_id: string | null;
  customer_id: string | null;
  single_use: boolean;
  expires_at: number | null;
  created_at: number;
}
export interface SLine {
  description: string;
  quantity: number;
  unit_price: string; // minor units
  amount: string;
}
export interface SInvoice {
  id: string;
  merchant_id: string;
  number: string | null;
  status: "draft" | "open" | "paid";
  revision: number; // +1 on every draft edit; an approval is bound to one revision
  customer_id: string;
  currency: string;
  line_items: SLine[];
  subtotal: string;
  discount: { type: "amount" | "percent"; bps: string | null; amount: string } | null;
  tax: { name: string; bps: string; amount: string } | null;
  total: string;
  amount_paid: string; // projection of succeeded payments; `reconcile` rebuilds it
  memo: string | null;
  due_date: string;
  created_at: number;
  finalized_at: number | null;
  paid_at: number | null;
}
export interface SPayment {
  id: string; // the provider's payment id
  merchant_id: string;
  target: { kind: "invoice" | "link"; id: string };
  amount: string; // USDT minor units
  currency: "USDT";
  status: "pending" | "succeeded" | "failed";
  sequence: number; // the highest provider event sequence applied
  created_at: number;
  succeeded_at: number | null;
  provider_ref: string;
}
export interface SIdempotency {
  merchant_id: string;
  route: string;
  key: string;
  hash: string;
  status: number;
  body: unknown;
  result_id: string | null;
  at: number;
}
/** A request to publish one exact invoice revision; an Owner decides it once (production review F4). */
export interface SApproval {
  id: string;
  merchant_id: string;
  invoice_id: string;
  revision: number;
  hash: string; // the invoice content's hash at the request
  total: string;
  currency: string;
  customer_id: string;
  requested_at: number;
  expires_at: number;
  status: "pending" | "approved" | "rejected" | "superseded" | "expired";
  decided_at: number | null;
}
export interface SEventLog {
  id: string;
  type: string;
  at: number;
  outcome: "applied" | "duplicate" | "stale" | "rejected";
  reason: string;
}
export interface SandboxState {
  version: 1;
  created_at: number;
  webhook_secret: string; // the simulated provider's signing secret: never in any output
  merchants: SMerchant[];
  keys: SKey[];
  customers: SCustomer[];
  links: SLink[];
  invoices: SInvoice[];
  payments: SPayment[];
  approvals: SApproval[];
  idempotency: SIdempotency[];
  processed_events: string[];
  event_log: SEventLog[];
}

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
export const newId = (prefix: string) => `${prefix}_${randomBytes(12).toString("base64url")}`;
export const newSandboxKey = () => `wf_sbx_${randomBytes(24).toString("base64url")}`;

/** Where the sandbox lives by default: %APPDATA%\whiteflow-mcp on Windows, else $XDG_CONFIG_HOME or ~/.config. */
export function defaultStateDir(env: Record<string, string | undefined> = process.env): string {
  if (env.WHITEFLOW_STATE_DIR) return env.WHITEFLOW_STATE_DIR;
  const base = process.platform === "win32" && env.APPDATA ? env.APPDATA : env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "whiteflow-mcp");
}

export const stateFile = (dir: string) => join(dir, "sandbox.json");
const credentialsFile = (dir: string) => join(dir, "sandbox-credentials.json");

const empty = (): SandboxState => ({
  version: 1,
  created_at: Date.now(),
  webhook_secret: randomBytes(32).toString("hex"),
  merchants: [],
  keys: [],
  customers: [],
  links: [],
  invoices: [],
  payments: [],
  approvals: [],
  idempotency: [],
  processed_events: [],
  event_log: [],
});

/** A sandbox made before round 2 gets the fields it lacks (no approvals yet, revision 1, the Owner-approval policy). */
const current = (state: SandboxState): SandboxState => ({
  ...state,
  approvals: state.approvals ?? [],
  merchants: state.merchants.map((m) => ({ ...m, publish_policy: m.publish_policy ?? "owner_approval" })),
  invoices: state.invoices.map((i) => ({ ...i, revision: i.revision ?? 1 })),
});

export const read = (dir: string): SandboxState => current(snapshot(stateFile(dir), empty));
export const change = <R>(dir: string, fn: (state: SandboxState) => { next?: SandboxState; result: R }): R => transact(stateFile(dir), empty, (state) => fn(current(state)));

/** Adds a simulated merchant with one key; returns the key (shown once, like a real one). */
export function addMerchant(dir: string, opts: { name: string; timezone: string; scopes?: Scope[]; expiresAt?: number | null; now?: number }): { merchantId: string; apiKey: string; keyId: string } {
  const apiKey = newSandboxKey(), merchantId = newId("mer"), keyId = newId("key");
  change(dir, (state) => ({
    next: {
      ...state,
      merchants: [...state.merchants, { id: merchantId, name: opts.name, timezone: opts.timezone, next_number: 1001, publish_policy: "owner_approval" }],
      keys: [...state.keys, { id: keyId, merchant_id: merchantId, hash: sha256(apiKey), label: "sandbox", scopes: opts.scopes ?? ALL_SCOPES, expires_at: opts.expiresAt ?? null, revoked_at: null }],
    },
    result: undefined,
  }));
  return { merchantId, apiKey, keyId };
}

/** Another key for an existing merchant (tests: narrower scopes, an expiry). */
export function addKey(dir: string, merchantId: string, opts: { scopes: Scope[]; expiresAt?: number | null }): string {
  const apiKey = newSandboxKey();
  change(dir, (state) => ({
    next: { ...state, keys: [...state.keys, { id: newId("key"), merchant_id: merchantId, hash: sha256(apiKey), label: "sandbox", scopes: opts.scopes, expires_at: opts.expiresAt ?? null, revoked_at: null }] },
    result: undefined,
  }));
  return apiKey;
}

/** The default sandbox merchant's key: created with the sandbox on first use, kept owner-only next to it. */
export function ensureSandbox(dir: string, timezone: string): { apiKey: string; created: boolean } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = credentialsFile(dir);
  if (existsSync(file) && existsSync(stateFile(dir))) {
    let saved: { api_key?: string };
    try {
      saved = JSON.parse(readFileSync(file, "utf8")) as { api_key?: string };
    } catch {
      // never JSON.parse's own message: it quotes the file, i.e. part of the key (security review 052 L3)
      throw new Error(`${file} is damaged. Delete it and the sandbox folder to start a fresh sandbox.`);
    }
    if (saved.api_key && SANDBOX_KEY.test(saved.api_key)) return { apiKey: saved.api_key, created: false };
  }
  const { apiKey } = addMerchant(dir, { name: "Demo Business (sandbox)", timezone });
  writeFileSync(file, JSON.stringify({ api_key: apiKey, note: "Sandbox only: a simulated key for the local WhiteFlow simulator. It works nowhere else." }, null, 2), { mode: 0o600 });
  return { apiKey, created: true };
}
