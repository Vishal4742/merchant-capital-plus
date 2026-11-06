// POST /api/v1/invoices/:id/pay: the customer's signed authorization for one invoice (FR-PAY-3). The checkout route's
// money rules: the server rebuilds the payment from the invoice and fee it reads on chain (never from the browser),
// checks the signature before relaying, keeps one payment in flight per invoice, and counts it only when the chain
// says so. Phase 3 MerchantPay: the customer pays what is still owed plus relayFee on top, and the invoice turns Paid
// once fully paid. MerchantPay itself never takes more than is owed (WrongAmount) or pays a paid invoice (InvoiceNotOpen).
import { verifyTypedData } from "viem";
import { merchantConfig, payConfig } from "../../../../../../lib/config.ts";
import { invoicePaid, readInvoice, readRelayFee, readUsdtBalance } from "../../../../../../lib/onchain.ts";
import { invoiceAuthorization, parseApproval } from "../../../../../../lib/pay.ts";
import { NOT_FUNDED, UNKNOWN, relayPayInvoice } from "../../../../../../lib/relay.ts";
import { invoiceState, isShopInvoice, type InvoiceState } from "../../../../../../lib/settle.ts";
import { claimPayment, invoiceAttempt, invoiceLock, releasePayment, setInvoiceAttempt } from "../../../../../../lib/sessions.ts";

const fail = (status: number, error: string) => Response.json({ error }, { status });
const NOT_FOUND = "This invoice doesn't exist. Check the link with whoever sent it.";
const STILL_PENDING = "We're still confirming an earlier attempt. Don't pay again; check this page again in a few minutes.";
const NOT_READ = "We couldn't check this invoice right now. Nothing was charged; try again in a moment.";
const READ_TRIES = 2; // a customer is waiting: fail fast, nothing is charged
const logged = (what: string) => (error: unknown) => {
  console.error(`${what} failed: ${error instanceof Error ? error.message : String(error)}`);
  return null;
};

function alreadyPaid(id: string) {
  const receipt = invoiceAttempt(id).receipt;
  return Response.json({ error: "This invoice is already paid.", paid: true, receiptId: receipt?.paymentId ?? null, txHash: receipt?.txHash ?? null }, { status: 409 });
}

function closed(id: string, state: Exclude<InvoiceState, "open">) {
  if (state === "missing") return fail(404, NOT_FOUND);
  if (state === "cancelled") return fail(410, "This invoice was cancelled, so it can't be paid. Nothing was charged.");
  if (state === "pending") return fail(409, STILL_PENDING);
  return alreadyPaid(id);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d{0,19}$/.test(id)) return fail(404, NOT_FOUND);
  const pay = payConfig();
  if (!pay) return fail(503, "Payments aren't live on this server yet.");
  const approval = parseApproval(await request.json().catch(() => null));
  if ("error" in approval) return fail(400, approval.error);
  const { from: payer, salt, signature, validBefore } = approval;

  const invoiceId = BigInt(id);
  // one multicall: the invoice, the fee and the guest's balance (a failed balance read isn't fatal: the relayer checks too)
  const [invoice, fee, balance] = await Promise.all([
    readInvoice(pay.merchantPay, invoiceId, { tries: READ_TRIES }).catch(logged(`invoice ${id}: chain read`)),
    readRelayFee(pay.merchantPay, { tries: READ_TRIES }).catch(logged(`invoice ${id}: fee read`)),
    readUsdtBalance(payer, { tries: READ_TRIES }).catch(() => null),
  ]);
  if (!invoice || fee === null) return fail(503, NOT_READ);
  if (!isShopInvoice(invoice, merchantConfig()?.merchant)) return fail(404, NOT_FOUND); // only our shop's invoices
  const before = invoiceState(id, invoice.status);
  if (before !== "open") return closed(id, before);

  // what is still owed, and the fee on top: exactly what MerchantPay will credit and pull
  const terms = { merchantPay: pay.merchantPay, invoiceId, amount: invoice.amount - invoice.paid, fee };
  // a malformed signature (bad v, r = 0, a point off the curve) throws: it is a mismatch, not a server error
  const valid = await verifyTypedData({ ...invoiceAuthorization(terms, payer, salt, validBefore), address: payer, signature }).catch(() => false);
  // the invoice or fee changed since the page loaded (someone paid part of it, or the owner set a new fee)
  if (!valid) return fail(400, "This approval doesn't match the invoice. Nothing was charged. Reload this page and try again.");
  // an unfunded guest hears "this is a demo" now, before anything is locked or relayed (UX and security review 005 F1)
  if (balance !== null && balance < terms.amount + terms.fee) return fail(400, NOT_FUNDED);

  const lock = invoiceLock(id);
  if (!claimPayment(lock)) return fail(409, "This invoice is already being paid.");
  try {
    // a request that held the lock before us may have paid it or left an unknown outcome
    if (invoiceAttempt(id).receipt) return alreadyPaid(id);
    const state = invoiceState(id, invoice.status);
    if (state !== "open") return closed(id, state);
    const markPending = () => setInvoiceAttempt(id, { ...invoiceAttempt(id), pending: { from: payer, validBefore } });

    const result = await relayPayInvoice({ relayerUrl: pay.relayerUrl, invoiceId, from: payer, amount: terms.amount, validBefore, salt, signature });
    if (!result.ok) {
      if (result.unknown) markPending(); // it may settle: the chain decides later
      else if (result.refused) {
        // a refusal can mean someone paid or cancelled it meanwhile (InvoiceNotOpen in the relayer's simulation)
        const now = await readInvoice(pay.merchantPay, invoiceId, { tries: READ_TRIES }).catch(logged(`invoice ${id}: chain read after refusal`));
        if (now && now.status !== "open") return closed(id, now.status);
      }
      return fail(result.status, result.message);
    }
    // consumer rule (ARCHITECTURE §2): the chain, not the relayer's word, says it was paid, read at the relay's block
    const blockNumber = result.blockNumber && /^\d+$/.test(result.blockNumber) ? BigInt(result.blockNumber) : undefined;
    const paymentId = result.paymentId && /^[1-9]\d{0,19}$/.test(result.paymentId) ? result.paymentId : null;
    const confirmed =
      paymentId !== null &&
      Boolean(await invoicePaid({ ...terms, paymentId: BigInt(paymentId), payer, paidBefore: invoice.paid }, { blockNumber }).catch(logged(`invoice ${id}: chain read after relay`)));
    if (!confirmed) {
      markPending(); // the relayer says it went through: never invite a second payment
      return fail(504, UNKNOWN);
    }
    setInvoiceAttempt(id, { receipt: { paymentId, txHash: result.txHash } });
    return Response.json({ receiptId: paymentId, txHash: result.txHash });
  } finally {
    releasePayment(lock); // only guards concurrent requests; an unknown outcome is kept as the attempt's `pending`
  }
}
