// POST /api/v1/sessions/:id/pay: the customer's signed authorization for this checkout (FR-PAY-5).
// The server rebuilds the payment from its own session record and checks the signature before relaying,
// so the amount, merchant and order can't be changed by the browser, and a bad signature costs no gas.
// A link or page checkout may carry a discount code (FR-GW-12): its price is claimed (the hold frozen) under the
// in-flight lock, and that one price is verified, relayed, read on chain and recorded (batch-009 security F1-F3).
// Batch 021 (NFR-4): the sheet sends the units it signed as `amount`; one that isn't the claimed price is a 409 with the
// amount due (the sheet shows it), so the sheet no longer reads the voucher route before every approval.
import { verifyTypedData, type Address, type Hex } from "viem";
import { payConfig } from "../../../../../../lib/config.ts";
import { parseApproval, saleAuthorization, type Approval } from "../../../../../../lib/pay.ts";
import { readUsdtBalance, saleSettled } from "../../../../../../lib/onchain.ts";
import { announcePaid } from "../../../../../../lib/announce-paid.ts";
import { BUSY, NOT_FUNDED, UNKNOWN, relaySale } from "../../../../../../lib/relay.ts";
import { findPayment, gatewayCheckout, releaseClaim, settlePending } from "../../../../../../lib/settle.ts";
import type { Checkout } from "../../../../../../lib/server/checkouts.ts";
import { HttpError } from "../../../../../../lib/server/http.ts";
import { claimAmountDue } from "../../../../../../lib/server/vouchers.ts";
import { claimPayment, getSession, isInFlight, markPending, recordPayment, releasePayment, type Session } from "../../../../../../lib/sessions.ts";
import { formatUsdt, plainUsdt } from "../../../../../../lib/usdt.ts";

const fail = (status: number, error: string) => Response.json({ error }, { status });
const LONGER_THAN_CHECKOUT = "This approval would last longer than the checkout, which expires sooner. Nothing was charged. Please try again.";
const MISMATCH = "This approval doesn't match the checkout. Nothing was charged.";
const READ_TRIES = 2; // a customer is waiting: fail fast (a failed balance read isn't fatal: the relayer checks too)
const EXPIRED = "This checkout has expired. Ask the shop for a new one.";
const STILL_PENDING = "We're still confirming an earlier attempt. Don't pay again; check this page again in a few minutes.";
const alreadyPaid = (id: string) => Response.json({ error: "Already paid.", receiptId: id, txHash: getSession(id)?.payment?.txHash ?? null }, { status: 409 });
type Pay = NonNullable<ReturnType<typeof payConfig>>;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return fail(404, "This checkout doesn't exist.");
  if (session.payment) return alreadyPaid(id);
  // a pending or in-flight attempt may pay: never send that customer to a new checkout before the chain says (security
  // R1 S1). In flight, the request falls through to claimPayment's 409, which the sheet shows as "confirming" (R2 F1).
  if (Date.now() > session.expiresAt && !session.pending && !isInFlight(id)) return fail(410, EXPIRED);
  const pay = payConfig();
  if (!pay) return fail(503, "Payments aren't live on this server yet.");

  // a link or page checkout prices through its voucher hold; a database we can't read refuses before anything is
  // locked or relayed (its price is unknown). Read while the body arrives (NFR-4); it never rejects, so a bad body's
  // 400 below leaves nothing unhandled.
  const checkoutRead = gatewayCheckout(id).catch((error: unknown) => {
    console.error(`checkout ${id}: checkout read failed: ${error instanceof Error ? error.name : "error"}`);
    return undefined;
  });
  const body: unknown = await request.json().catch(() => null);
  const approval = parseApproval(body);
  if ("error" in approval) return fail(400, approval.error);
  const checkout = await checkoutRead;
  if (checkout === undefined) return fail(503, BUSY);
  return checkout ? payCheckout(id, session, pay, approval, checkout, (body as { amount?: unknown }).amount) : payShopSession(id, session, pay, approval);
}

/** A shop's own session (created with its key): today's path, at the session's amount. */
async function payShopSession(id: string, session: Session, pay: Pay, { from: payer, salt, signature, validBefore }: Approval): Promise<Response> {
  const sale = { merchantPay: pay.merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount: session.amount };
  // a malformed signature (bad v, r = 0, a point off the curve) throws: it is a mismatch, not a server error
  const valid = await verifyTypedData({ ...saleAuthorization(sale, payer, salt, validBefore), address: payer, signature }).catch(() => false);
  if (!valid) return fail(400, MISMATCH);
  // an unfunded guest hears "this is a demo" now, before anything is locked or relayed (UX and security review 005 F1);
  // if the read fails, carry on: the relayer checks the balance too. Not while an earlier attempt is pending: if it
  // landed it spent this balance, and settlePending below shows its receipt (code review 005 R2-F1)
  const balance = await readUsdtBalance(payer, { tries: READ_TRIES }).catch(() => null);
  if (balance !== null && balance < session.amount && !session.pending) return fail(400, NOT_FUNDED);

  if (!claimPayment(id)) return fail(409, "This checkout is already being paid.");
  try {
    // an earlier attempt with an unknown outcome is settled by the chain before anything new is relayed
    const state = await settlePending(getSession(id) ?? session, pay.merchantPay);
    if (state === "paid") return alreadyPaid(id);
    if (state === "pending") return fail(409, STILL_PENDING);
    if (Date.now() > session.expiresAt) return fail(410, EXPIRED);
    // the approval never outlives the checkout (ARCHITECTURE §4b), so nothing can settle after it says "expired"
    if (validBefore > BigInt(Math.floor(session.expiresAt / 1000))) return fail(400, LONGER_THAN_CHECKOUT);
    const result = await relaySale({ relayerUrl: pay.relayerUrl, merchant: session.merchant, orderRef: session.orderRef, from: payer, amount: session.amount, validBefore, salt, signature });
    if (!result.ok) {
      if (result.unknown) markPending(id, { from: payer, validBefore }); // it may settle: the chain decides later
      // a refusal can mean the order is already paid (OrderPaid): show the receipt, never "start again"
      else if (result.refused && (await findPayment(session, pay.merchantPay, payer))) return Response.json({ receiptId: id, txHash: null });
      return fail(result.status, result.message);
    }
    return await recordRelayed(id, session, sale, payer, result, { from: payer, validBefore });
  } finally {
    releasePayment(id); // only guards concurrent requests; an unknown outcome is kept as session.pending
  }
}

/**
 * A link or page checkout, in the order the batch-009 security review fixes (F1): the claim sits after the in-flight
 * lock and the open-state check, and one claimed price is verified, relayed, read and recorded (F3). The hold is
 * released only by this attempt, under the lock, when nothing can settle at that price: a refusal before the relay,
 * or a relayer answer that says nothing was sent. Never on an unknown outcome or an order the chain shows paid.
 * `shown` is the units the sheet signed (absent from an older sheet: then the verify alone decides).
 */
async function payCheckout(id: string, session: Session, pay: Pay, { from: payer, salt, signature, validBefore }: Approval, checkout: Checkout, shown: unknown): Promise<Response> {
  const signedFor = typeof shown === "string" && /^\d{1,30}$/.test(shown) ? BigInt(shown) : undefined;
  if (shown !== undefined && signedFor === undefined) return fail(400, "amount must be USDT units.");
  if (validBefore > BigInt(Math.floor(session.expiresAt / 1000))) return fail(400, LONGER_THAN_CHECKOUT);
  if (!claimPayment(id)) return fail(409, "This checkout is already being paid.");
  try {
    const state = await settlePending(getSession(id) ?? session, pay.merchantPay, { locked: true });
    if (state === "paid") return alreadyPaid(id);
    if (state === "pending") return fail(409, STILL_PENDING);
    if (Date.now() > session.expiresAt) return fail(410, EXPIRED);

    const refuse = async (status: number, error: string) => {
      await releaseClaim(id);
      return fail(status, error);
    };
    // frozen from here: every refusal below releases it. A 410 (a single-use link already paid or being paid by another
    // checkout, claude-contracts 08:39) froze nothing for this attempt, so it is shown and nothing is released; any other
    // failure may have frozen the hold before its reply was lost, so that one releases.
    const claimed = await claimAmountDue(id).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    if ("error" in claimed) return claimed.error instanceof HttpError && claimed.error.status === 410 ? fail(410, claimed.error.message) : refuse(503, BUSY);
    const price = claimed.value;
    if (price === null) return refuse(503, BUSY);
    // the sheet showed and signed another total (a code changed in another tab): unlike the lock's 409 and
    // STILL_PENDING, this attempt claimed and stops before the relay, so its claim is released (F1 (i)); the reply
    // carries the amount due for the sheet to show
    if (signedFor !== undefined && signedFor !== price) {
      await releaseClaim(id);
      const due = { amountDue: plainUsdt(price), discount: plainUsdt(checkout.usdtAmount - price), amountUnits: price.toString() };
      return Response.json({ error: `The total is now ${formatUsdt(price)} USDT. Check it, then hold to pay again.`, ...due }, { status: 409 });
    }
    const sale = { merchantPay: pay.merchantPay, merchant: session.merchant, orderRef: session.orderRef, amount: price };
    const valid = await verifyTypedData({ ...saleAuthorization(sale, payer, salt, validBefore), address: payer, signature }).catch(() => false);
    if (!valid) return refuse(400, MISMATCH);
    const balance = await readUsdtBalance(payer, { tries: READ_TRIES }).catch(() => null);
    if (balance !== null && balance < price) return refuse(400, NOT_FUNDED);

    const attempt = { from: payer, validBefore, amount: price };
    const result = await relaySale({ relayerUrl: pay.relayerUrl, merchant: session.merchant, orderRef: session.orderRef, from: payer, amount: price, validBefore, salt, signature });
    if (!result.ok) {
      if (result.unknown) {
        markPending(id, attempt); // it may settle at this price: the chain decides later, and the hold stays frozen
        return fail(result.status, result.message);
      }
      if (!result.refused) return refuse(result.status, result.message); // busy or bad input: nothing was sent
      // a 422 can mean the order is already paid (paySale is open to anyone holding a signature): ask the chain first
      const found = await findPayment(session, pay.merchantPay, payer, price);
      if (found) return Response.json({ receiptId: id, txHash: null });
      if (found === null) return refuse(result.status, result.message);
      markPending(id, attempt); // the read failed: keep the hold frozen until the chain says (settlePending)
      return fail(504, UNKNOWN);
    }
    return await recordRelayed(id, session, sale, payer, result, attempt);
  } finally {
    releasePayment(id);
  }
}

/** Consumer rule (ARCHITECTURE §2): the chain, not the relayer's word, says the order is paid, read at its block and at
 *  the relayed amount. Unconfirmed: pending, never a second payment. */
async function recordRelayed(
  id: string,
  session: Session,
  sale: { merchantPay: Address; merchant: Address; orderRef: Hex; amount: bigint },
  payer: Address,
  result: { txHash: Hex; blockNumber: string | null },
  attempt: NonNullable<Session["pending"]>,
): Promise<Response> {
  const blockNumber = result.blockNumber && /^\d+$/.test(result.blockNumber) ? BigInt(result.blockNumber) : undefined;
  const paymentId = await saleSettled({ ...sale, payer }, { blockNumber }).catch((error: unknown) => {
    console.error(`checkout ${id}: chain read after relay failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (!paymentId) {
    markPending(id, attempt); // the relayer says it went through: never invite a second payment
    return fail(504, UNKNOWN);
  }
  announcePaid(recordPayment(id, { txHash: result.txHash, blockNumber: result.blockNumber, paymentId, from: payer, paidAt: Date.now(), amount: sale.amount }), sale.amount);
  return Response.json({ receiptId: id, txHash: result.txHash });
}
