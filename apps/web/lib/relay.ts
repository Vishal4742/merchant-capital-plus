// Server-only client for the relayer's POST /relay (claude-relayer, ARCHITECTURE §3).
// The browser never calls the relayer: our server forwards a verified authorization and records the result.
import { after } from "next/server.js"; // the .js path resolves under Node's test runner too
import type { Address, Hex } from "viem";
import { NOT_FUNDED } from "./outcome.ts";

interface Signed {
  relayerUrl: string;
  from: Address;
  /** paySale: the price. payInvoice: the credited amount (MerchantPay adds relayFee on top). */
  amount: bigint;
  validBefore: bigint;
  salt: Hex;
  signature: Hex;
}

export interface RelaySale extends Signed {
  merchant: Address;
  orderRef: Hex;
}

export interface RelayInvoice extends Signed {
  invoiceId: bigint;
}

// `unknown`: the relayer may have sent the transaction, so the checkout or invoice must not be paid again blindly.
export type RelayResult =
  | { ok: true; txHash: Hex; blockNumber: string | null; paymentId: string | null }
  // unknown: it may have been sent, so the payment goes pending. refused: the relayer turned it down (422), which can
  // also mean it was already paid (OrderPaid or InvoiceNotOpen in its simulation), so the caller checks the chain first.
  // txHash (batch 031 A14): the relayer's own reference for an attempt it may have broadcast, kept so the attempt is recoverable
  | { ok: false; status: number; message: string; unknown?: boolean; refused?: boolean; txHash?: Hex };

export const UNKNOWN = "We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes.";
export const BUSY = "Payments are busy right now. Nothing was charged; try again in a moment.";
/** Batch 031 round 4 (A12): the relayer already has this exact approval (it may be on its way on-chain). Never "nothing was
 *  charged, start again": the caller still checks the chain (receipt if paid) and doesn't lock the checkout, but the
 *  customer is told not to pay again yet. The contracts stop a double charge anyway (OrderPaid / invoice capacity). */
export const ALREADY_SUBMITTED = "This approval was already submitted. Don't pay again yet: refresh this page in a minute to see whether it went through.";
/** Batch 031 round 3 (A10): the relayer's temporary payer cooldown (429, code payer_cooldown, retry_after_s), decided
 *  before anything is sent. The wording names no codes and never suggests a payment is in flight. */
export function cooldownMessage(retryAfterS: unknown): string {
  const s = typeof retryAfterS === "number" && Number.isFinite(retryAfterS) && retryAfterS > 0 ? retryAfterS : null;
  const when = s === null ? "a few minutes" : `about ${Math.max(1, Math.ceil(s / 60))} minute${Math.ceil(s / 60) === 1 ? "" : "s"}`;
  return `This wallet is paused for ${when} after several failed payment attempts. Nothing was charged; please try again then.`;
}
// connection never opened, so the request can't have reached the relayer
const NOT_SENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

// POST /relay (claude-relayer, agentbus 22:13 + 22:50): {action, args (decimal strings), sig} → 200 {txHash,
// blockNumber, paymentId} after the receipt (up to 30 s) | 400 bad input | 422 {code} the authorization won't work
// | 503 refused before sending (gas cap, paused, budget) | 502 RPC trouble, maybe sent: poll, never re-POST.
// Never show the relayer's own error text to customers (FR-PAY-7): map by status and code only.
export const relaySale = (sale: RelaySale) => relay(sale, "paySale", { merchant: sale.merchant, orderRef: sale.orderRef });

/** MerchantPay.payInvoice through the same contract; args mirror the function's (claude-relayer RL2 adds the action;
 *  until then the relayer answers 400, which maps to "Nothing was charged"). */
export const relayPayInvoice = (invoice: RelayInvoice) => relay(invoice, "payInvoice", { invoiceId: invoice.invoiceId.toString() });

export { NOT_FUNDED }; // the routes import it from here with the other relay outcomes

/** claude-relayer batch 006 (06:06): every POST /relay carries x-relay-secret = RELAY_API_SECRET, read on the server only
 *  (this module is imported by API routes, never by the browser). Unset: no header, for the relayer that doesn't ask. */
function relayAuth(relayerUrl: string, env: Record<string, string | undefined> = process.env): Record<string, string> {
  const secret = env.RELAY_API_SECRET?.trim();
  // only over https, or to this machine: plain http elsewhere would put the secret on the wire (security 008 F2)
  const url = new URL(relayerUrl);
  const safe = url.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  return secret && safe ? { "x-relay-secret": secret } : {};
}

async function relay(signed: Signed, action: "paySale" | "payInvoice", target: Record<string, string>): Promise<RelayResult> {
  const args = { ...target, from: signed.from, amount: signed.amount.toString(), validAfter: "0", validBefore: signed.validBefore.toString(), salt: signed.salt };
  const body = { action, args, sig: signed.signature };
  let res: Response;
  try {
    res = await fetch(new URL("/relay", signed.relayerUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...relayAuth(signed.relayerUrl) },
      body: JSON.stringify(body),
      redirect: "manual", // never carry the secret and the signed body to another address (security 008 F2)
      signal: AbortSignal.timeout(35_000), // longer than the relayer's 30 s receipt wait
    });
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code;
    if (code && NOT_SENT.has(code)) return { ok: false, status: 503, message: BUSY };
    // a timeout or a connection dropped mid-request: the relayer may have sent it
    return { ok: false, status: 504, unknown: true, message: UNKNOWN };
  }
  const data = (await res.json().catch(() => ({}))) as { txHash?: Hex; blockNumber?: string | number; paymentId?: string | number; code?: string; retry_after_s?: unknown };
  const str = (v: string | number | undefined) => (v === undefined ? null : String(v));
  // the relayer's refusal code (never the body or a secret), so an operator can tell busy from breaker or storage (batch 057)
  if (!res.ok) console.error(`relay ${action}: relayer answered ${res.status}${typeof data.code === "string" ? ` ${data.code.slice(0, 40)}` : ""}`);
  if (res.status === 429 && data.code === "payer_cooldown") return { ok: false, status: 429, message: cooldownMessage(data.retry_after_s) };
  if (res.ok && data.txHash && /^0x[0-9a-fA-F]{64}$/.test(data.txHash)) return { ok: true, txHash: data.txHash, blockNumber: str(data.blockNumber), paymentId: str(data.paymentId) };
  if (res.status === 422 && data.code === "insufficient_funds") return { ok: false, status: 400, refused: true, message: NOT_FUNDED };
  if (res.status === 422 && data.code === "replay") return { ok: false, status: 400, refused: true, message: ALREADY_SUBMITTED };
  const again = action === "paySale" ? "start the checkout again" : "try again"; // an invoice is reused: retry the same link
  if (res.status === 422) return { ok: false, status: 400, refused: true, message: `That approval didn't work. Nothing was charged; please ${again}.` };
  // 503: refused before sending (gas cap, paused, budget). 429: the relayer's rate limit, also before sending. A 403
  // with x-vercel-mitigated is Vercel's burst protection in front of the relayer: nothing was sent (claude-relayer 06:46).
  const mitigated = res.status === 403 && res.headers.get("x-vercel-mitigated") !== null;
  if (res.status === 503 || res.status === 429 || mitigated) return { ok: false, status: 503, message: BUSY };
  // a 502 or other 5xx (or a 200 without a valid txHash) may have been sent: the payment goes pending and the chain
  // settles it (lib/settle.ts). ponytail: a 502's txHash isn't used yet. A sale's chain read finds the payment through
  // saleOf; an invoice's only sees that it turned Paid, with no receipt id (code review 005 F3, deferred).
  if (res.status >= 500 || res.ok) {
    const ref = typeof data.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(data.txHash) ? (data.txHash.toLowerCase() as Hex) : undefined;
    return { ok: false, status: 504, unknown: true, message: UNKNOWN, ...(ref && { txHash: ref }) };
  }
  return { ok: false, status: 400, message: "The payment didn't go through. Nothing was charged." };
}

export interface RelayerHealth {
  wbt: string | null;
  gasSpentToday: string | null;
  budgetLeft: string | null;
  usdtFeesUnswapped: string | null;
  paused: boolean;
}

/** GET /health from the relayer (FR-REL-6): who pays gas and how much is left. Null if unreachable. */
export async function relayerHealth(relayerUrl: string): Promise<RelayerHealth | null> {
  try {
    const res = await fetch(new URL("/health", relayerUrl), { signal: AbortSignal.timeout(3_000), cache: "no-store" });
    if (!res.ok) return null;
    const d = (await res.json()) as Record<string, unknown>;
    const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return { wbt: str(d.wbt), gasSpentToday: str(d.gasSpentToday), budgetLeft: str(d.budgetLeft), usdtFeesUnswapped: str(d.usdtFeesUnswapped), paused: d.paused === true };
  } catch {
    return null;
  }
}

const WARM_EVERY_MS = 30_000;
let lastWarmAt = Number.NEGATIVE_INFINITY;

/** Warms the relayer before a customer pays (claude-relayer 09:42): on Vercel, /health runs in the same function as
 *  /relay, so one ping when a checkout opens keeps the instance and its RPC socket ready (7.31 s cold, 4.32 s warm).
 *  Fire and forget after the response (Next's after(); at once outside a request), a 3 s cap, never throws, and only
 *  to an https or loopback relayer like the secret. /health is public, so no header is sent. */
export function warmRelayer(relayerUrl: string | undefined, schedule: (task: () => Promise<void>) => void = after, now = Date.now()): void {
  if (!relayerUrl) return;
  let url: URL;
  try {
    url = new URL("/health", relayerUrl); // a URL like "mailto:x" parses but can't take a path: it throws here (security 020 F3)
  } catch {
    return;
  }
  if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return;
  // at most one ping per server instance per WARM_EVERY_MS: page loads must never become relayer traffic from our IP,
  // which Vercel's burst protection would challenge, blocking every /relay (security review 020 F1, HIGH)
  if (now - lastWarmAt < WARM_EVERY_MS) return;
  lastWarmAt = now;
  const ping = () =>
    fetch(url, { signal: AbortSignal.timeout(3_000), cache: "no-store" }).then(
      (res) => void res.body?.cancel().catch(() => undefined), // free the socket now, not at garbage collection
      () => undefined,
    );
  try {
    schedule(ping);
  } catch {
    void ping();
  }
}

