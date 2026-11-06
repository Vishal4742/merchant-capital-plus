// POST /api/v1/invoices/:id/acknowledge (public, FR-INV-8, batch 047): the debtor's signed acknowledgement that it owes
// this invoice. A message, never a transaction: no money moves. The server rebuilds what was signed from the invoice it
// reads on chain (never the browser's amount, merchant or due date), checks the signature against `debtor`, and keeps
// the first valid ack (lib/server/invoice-acks.ts). Our shop's open invoices only; the shop can't vouch for itself.
import { getAddress, isAddress, isHex, verifyTypedData } from "viem";
import { merchantConfig, payConfig } from "../../../../../../lib/config.ts";
import { ackTypedData } from "../../../../../../lib/invoice-ack.ts";
import { readInvoice } from "../../../../../../lib/onchain.ts";
import { clientIp, fail, handle, ok, rateLimit, readJson } from "../../../../../../lib/server/http.ts";
import { saveAck } from "../../../../../../lib/server/invoice-acks.ts";
import { isShopInvoice } from "../../../../../../lib/settle.ts";

const ACKS_PER_MINUTE = 10; // per IP: each call is a chain read and a database write
const READ_TRIES = 2; // a customer is waiting: fail fast
const MAX_BODY = 1_024; // {debtor, signature} is about 200 bytes
const NOT_FOUND = "This invoice doesn't exist. Check the link with whoever sent it.";

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => handle(() => post(request, context));

async function post(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  rateLimit(`ack:${clientIp(request)}`, ACKS_PER_MINUTE, 60_000);
  const { id } = await params;
  if (!/^[1-9]\d{0,19}$/.test(id)) return fail(404, NOT_FOUND);
  const pay = payConfig();
  if (!pay) return fail(503, "Invoices aren't live on this server yet.");
  const { debtor, signature } = await readJson(request, MAX_BODY);
  if (typeof debtor !== "string" || !isAddress(debtor)) return fail(400, "debtor must be an address.");
  if (typeof signature !== "string" || !isHex(signature) || signature.length !== 132) return fail(400, "signature must be 65 bytes of hex.");

  const invoice = await readInvoice(pay.merchantPay, BigInt(id), { tries: READ_TRIES }).catch((error: unknown) => {
    console.error(`invoice ${id}: ack chain read failed: ${error instanceof Error ? error.name : "error"}`);
    return null;
  });
  if (!invoice) return fail(503, "We couldn't check this invoice right now. Try again in a moment.");
  if (!isShopInvoice(invoice, merchantConfig()?.merchant)) return fail(404, NOT_FOUND);
  if (invoice.status === "paid") return fail(409, "This invoice is already paid, so there's nothing to acknowledge.");
  if (invoice.status === "cancelled") return fail(410, "This invoice was cancelled, so there's nothing to acknowledge.");
  if (debtor.toLowerCase() === invoice.merchant.toLowerCase()) return fail(400, "The shop can't acknowledge its own invoice.");

  const terms = { invoiceId: invoice.id, merchant: invoice.merchant, amount: invoice.amount, dueDate: invoice.dueDate };
  // a malformed signature (bad v, r = 0, a point off the curve) throws: it is a mismatch, not a server error
  const valid = await verifyTypedData({ ...ackTypedData(terms, debtor), address: debtor, signature }).catch(() => false);
  if (!valid) return fail(400, "This acknowledgement doesn't match the invoice. Reload this page and try again.");

  const stored = await saveAck(pay.merchantPay, invoice.id, getAddress(debtor), signature);
  if (stored.debtor.toLowerCase() !== debtor.toLowerCase()) return fail(409, "This invoice was already acknowledged by someone else.");
  return ok({ acknowledged: true, debtor: stored.debtor, signed_at: new Date(stored.signedAt).toISOString() });
}
