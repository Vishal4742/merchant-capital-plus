// Server-only checkout sessions (FR-PAY-4). The chain is the truth for money; this only remembers what
// a shop asked to be paid and which payment settled it, so the pay page needs no browser chain reads.
import { randomBytes, randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";

export const SESSION_TTL_MS = 30 * 60 * 1000;

export interface LineItem {
  name: string;
  qty: number;
  price: bigint; // USDT units
}

export interface Payment {
  txHash: Hex | null; // null when the payment was found on chain after an unknown outcome (lib/settle.ts)
  blockNumber: string | null;
  paymentId: string | null; // MerchantPay's Paid event id (relayer 200)
  from: Address;
  paidAt: number;
}

export interface Session {
  id: string;
  merchant: Address;
  merchantName: string;
  amount: bigint; // USDT units, 6 decimals
  orderRef: Hex; // bytes32 bound into the signed nonce
  reference: string; // the shop's own order label, e.g. "A-1042"
  items: LineItem[];
  createdAt: number;
  expiresAt: number;
  payment?: Payment;
  /** An attempt whose outcome is unknown (timeout, dropped connection, 5xx, an unconfirmed 200): the chain decides it. */
  pending?: { from: Address; validBefore: bigint };
}

// ponytail: in-memory store, so sessions vanish on restart and aren't shared between serverless
// instances. Move to Neon (`app_sessions`) when the Vercel project and DATABASE_URL exist.
const globalStore = globalThis as unknown as { __mcSessions?: Map<string, Session> };
const sessions = (globalStore.__mcSessions ??= new Map<string, Session>());

export function createSession(input: Omit<Session, "id" | "orderRef" | "createdAt" | "expiresAt" | "payment" | "pending">, now = Date.now()): Session {
  const session: Session = {
    ...input,
    id: randomUUID(),
    orderRef: `0x${randomBytes(32).toString("hex")}`,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}


/** Paid checkouts for one merchant, newest first (the dashboard's payments table). */
export function listPayments(merchant: string): { session: Session; payment: Payment }[] {
  const out: { session: Session; payment: Payment }[] = [];
  for (const session of sessions.values()) {
    if (session.payment && session.merchant.toLowerCase() === merchant.toLowerCase()) out.push({ session, payment: session.payment });
  }
  return out.sort((a, b) => b.payment.paidAt - a.payment.paidAt);
}

// One payment in flight per checkout: without this, two quick requests with different salts could both
// settle and charge the customer twice.
const inFlight = new Set<string>();

/** True if this caller may relay a payment for the session now; false if one is already in flight. */
export function claimPayment(id: string): boolean {
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  return true;
}

export function releasePayment(id: string): void {
  inFlight.delete(id);
}

export function isInFlight(id: string): boolean {
  return inFlight.has(id);
}

function update(id: string, change: (session: Session) => Session): Session {
  const session = sessions.get(id);
  if (!session) throw new Error("No such checkout");
  const next = change(session);
  sessions.set(id, next);
  return next;
}

/** First write wins: a later record (e.g. a reconcile without a txHash) never replaces a relayed payment. */
export function recordPayment(id: string, payment: Payment): Session {
  return update(id, (session) => (session.payment ? session : { ...session, payment, pending: undefined }));
}

export function markPending(id: string, pending: NonNullable<Session["pending"]>): Session {
  return update(id, (session) => ({ ...session, pending }));
}

/** Clears `expected` only if it is still the pending attempt: a newer one that arrived meanwhile stays. */
export function clearPending(id: string, expected: Session["pending"]): Session {
  return update(id, (session) => (session.pending === expected ? { ...session, pending: undefined } : session));
}
