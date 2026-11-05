// POST /api/v1/sessions/:id/pay: the customer's signed authorization for this checkout (FR-PAY-5).
// The server rebuilds the payment from its own session record and checks the signature before relaying,
// so the amount, merchant and order can't be changed by the browser, and a bad signature costs no gas.
import { isAddress, isHex, verifyTypedData, type Address, type Hex } from "viem";
import { payConfig } from "../../../../../../lib/config.ts";
import { saleAuthorization } from "../../../../../../lib/pay.ts";
import { saleSettled } from "../../../../../../lib/onchain.ts";
import { UNKNOWN, relaySale } from "../../../../../../lib/relay.ts";
import { findPayment, settlePending } from "../../../../../../lib/settle.ts";
import { claimPayment, getSession, markPending, recordPayment, releasePayment } from "../../../../../../lib/sessions.ts";

const fail = (status: number, error: string) => Response.json({ error }, { status });
const EXPIRED = "This checkout has expired. Ask the shop for a new one.";
const STILL_PENDING = "We're still confirming an earlier attempt. Don't pay again; check this page again in a few minutes.";
const alreadyPaid = (id: string) => Response.json({ error: "Already paid.", receiptId: id, txHash: getSession(id)?.payment?.txHash ?? null }, { status: 409 });
const MAX_RELAYER_WINDOW_S = 15 * 60; // the relayer refuses validBefore further out (ARCHITECTURE §3)

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return fail(404, "This checkout doesn't exist.");
  if (session.payment) return alreadyPaid(id);
  // a pending attempt may have paid: never send that customer to a new checkout before the chain says (security R1 S1)
  if (Date.now() > session.expiresAt && !session.pending) return fail(410, EXPIRED);
  const pay = payConfig();
  if (!pay) return fail(503, "Payments aren't live on this server yet.");

  const body = (await request.json().catch(() => null)) as { from?: unknown; salt?: unknown; validBefore?: unknown; signature?: unknown } | null;
  const from = body?.from, salt = body?.salt, signature = body?.signature;
  if (typeof from !== "string" || !isAddress(from)) return fail(400, "from must be an address.");
  if (typeof salt !== "string" || !isHex(salt) || salt.length !== 66) return fail(400, "salt must be 32 bytes of hex.");
  if (typeof signature !== "string" || !isHex(signature) || signature.length !== 132) return fail(400, "signature must be 65 bytes of hex.");
  if (typeof body?.validBefore !== "string" || !/^\d{1,12}$/.test(body.validBefore)) return fail(400, "validBefore must be a unix time.");
  const validBefore = BigInt(body.validBefore), now = BigInt(Math.floor(Date.now() / 1000));
  if (validBefore <= now + 30n || validBefore > now + BigInt(MAX_RELAYER_WINDOW_S)) {
    return fail(400, "This payment window is out of range. Please start again.");
  }

  const sale = { merchantPay: pay.merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount: session.amount };
  // a malformed signature (bad v, r = 0, a point off the curve) throws: it is a mismatch, not a server error
  const valid = await verifyTypedData({ ...saleAuthorization(sale, from as Address, salt as Hex, validBefore), address: from as Address, signature: signature as Hex }).catch(() => false);
  if (!valid) return fail(400, "This approval doesn't match the checkout. Nothing was charged.");

  if (!claimPayment(id)) return fail(409, "This checkout is already being paid.");
  try {
    const payer = from as Address;
    // an earlier attempt with an unknown outcome is settled by the chain before anything new is relayed
    const state = await settlePending(getSession(id) ?? session, pay.merchantPay);
    if (state === "paid") return alreadyPaid(id);
    if (state === "pending") return fail(409, STILL_PENDING);
    if (Date.now() > session.expiresAt) return fail(410, EXPIRED);
    const result = await relaySale({ relayerUrl: pay.relayerUrl, merchant: session.merchant, orderRef: session.orderRef, from: payer, amount: session.amount, validBefore, salt: salt as Hex, signature: signature as Hex });
    if (!result.ok) {
      if (result.unknown) markPending(id, { from: payer, validBefore }); // it may settle: the chain decides later
      // a refusal can mean the order is already paid (OrderPaid): show the receipt, never "start again"
      else if (result.refused && (await findPayment(session, pay.merchantPay, payer))) return Response.json({ receiptId: id, txHash: null });
      return fail(result.status, result.message);
    }
    // consumer rule (ARCHITECTURE §2): the chain, not the relayer's word, says the order is paid, read at its block
    const blockNumber = result.blockNumber && /^\d+$/.test(result.blockNumber) ? BigInt(result.blockNumber) : undefined;
    const paymentId = await saleSettled({ ...sale, payer }, { blockNumber }).catch((error: unknown) => {
      console.error(`checkout ${id}: chain read after relay failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (!paymentId) {
      markPending(id, { from: payer, validBefore }); // the relayer says it went through: never invite a second payment
      return fail(504, UNKNOWN);
    }
    recordPayment(id, { txHash: result.txHash, blockNumber: result.blockNumber, paymentId, from: payer, paidAt: Date.now() });
    return Response.json({ receiptId: id, txHash: result.txHash });
  } finally {
    releasePayment(id); // only guards concurrent requests; an unknown outcome is kept as session.pending
  }
}
