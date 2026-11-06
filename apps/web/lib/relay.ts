// Server-only client for the relayer's POST /relay (claude-relayer, ARCHITECTURE §3).
// The browser never calls the relayer: our server forwards a verified authorization and records the result.
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
  | { ok: false; status: number; message: string; unknown?: boolean; refused?: boolean };

export const UNKNOWN = "We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes.";
const BUSY = "Payments are busy right now. Nothing was charged; try again in a moment.";
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
  const data = (await res.json().catch(() => ({}))) as { txHash?: Hex; blockNumber?: string | number; paymentId?: string | number; code?: string };
  const str = (v: string | number | undefined) => (v === undefined ? null : String(v));
  if (res.ok && data.txHash && /^0x[0-9a-fA-F]{64}$/.test(data.txHash)) return { ok: true, txHash: data.txHash, blockNumber: str(data.blockNumber), paymentId: str(data.paymentId) };
  if (res.status === 422 && data.code === "insufficient_funds") return { ok: false, status: 400, refused: true, message: NOT_FUNDED };
  const again = action === "paySale" ? "start the checkout again" : "try again"; // an invoice is reused: retry the same link
  if (res.status === 422) return { ok: false, status: 400, refused: true, message: `That approval didn't work. Nothing was charged; please ${again}.` };
  // 503: refused before sending (gas cap, paused, budget). 429: the relayer's rate limit, also before sending. A 403
  // with x-vercel-mitigated is Vercel's burst protection in front of the relayer: nothing was sent (claude-relayer 06:46).
  const mitigated = res.status === 403 && res.headers.get("x-vercel-mitigated") !== null;
  if (res.status === 503 || res.status === 429 || mitigated) return { ok: false, status: 503, message: BUSY };
  // a 502 or other 5xx (or a 200 without a valid txHash) may have been sent: the payment goes pending and the chain
  // settles it (lib/settle.ts). ponytail: a 502's txHash isn't used yet. A sale's chain read finds the payment through
  // saleOf; an invoice's only sees that it turned Paid, with no receipt id (code review 005 F3, deferred).
  if (res.status >= 500 || res.ok) return { ok: false, status: 504, unknown: true, message: UNKNOWN };
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
