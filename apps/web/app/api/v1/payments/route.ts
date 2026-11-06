// GET /api/v1/payments?limit&cursor: the shop lists its payments with its secret key (FR-GW-5, the SDK's payments.list).
// Which payments: the Paid log index for MERCHANT_ADDRESS (untrusted: ids only). What each one is: payments(id) on chain.
// txHash, invoiceId and paidAt come from the index's Paid log, not the chain (security review 006 F7): labels for
// finding the payment, never money. The amount, what was refunded and the merchant are read on chain.
// ponytail: a payment shows once Blockscout has indexed it (seconds after the receipt); GET /api/v1/sessions/:id
// answers sooner for one checkout.
import { merchantConfig, payConfig, shopAuthorized } from "../../../../lib/config.ts";
import { paidLogs, readPayment } from "../../../../lib/onchain.ts";
import { listPayments } from "../../../../lib/sessions.ts";
import { plainUsdt as usdt } from "../../../../lib/usdt.ts"; // one API amount format across lanes: "1234.50"

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const fail = (status: number, error: string) => Response.json({ error }, { status });
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function GET(request: Request) {
  const config = merchantConfig();
  if (!config) return fail(503, "Checkout isn't set up on this server.");
  if (!shopAuthorized(request, config.apiKey)) return fail(401, "Missing or wrong API key.");
  const pay = payConfig();
  if (!pay) return fail(503, "Payments aren't connected on this server yet.");

  const query = new URL(request.url).searchParams;
  const limitText = query.get("limit") ?? String(DEFAULT_LIMIT), cursorText = query.get("cursor");
  const limit = /^\d{1,3}$/.test(limitText) ? Number(limitText) : 0;
  if (limit < 1 || limit > MAX_LIMIT) return fail(400, `limit must be a whole number from 1 to ${MAX_LIMIT}.`);
  if (cursorText !== null && !/^[1-9]\d{0,77}$/.test(cursorText)) return fail(400, "cursor must be the `next` value of the previous page.");
  const cursor = cursorText === null ? null : BigInt(cursorText);

  try {
    const logs = await paidLogs(pay.merchantPay, { merchant: config.merchant });
    // newest first by payment id (MerchantPay counts up), one row per id, starting after the cursor
    const rest = [...new Map(logs.map((log) => [log.paymentId, log])).values()]
      .filter((log) => cursor === null || log.paymentId < cursor)
      .sort((a, b) => (a.paymentId < b.paymentId ? 1 : -1));
    const page = rest.slice(0, limit);
    const records = await Promise.all(page.map((log) => readPayment(pay.merchantPay, log.paymentId)));
    const sessions = new Map(listPayments(config.merchant).map(({ session, payment }) => [payment.paymentId, session]));
    const data = page.flatMap((log, i) => {
      const record = records[i];
      if (record.gross === 0n || !same(record.merchant, config.merchant)) return []; // the index named a payment that isn't this merchant's
      const session = sessions.get(log.paymentId.toString());
      return [
        {
          paymentId: log.paymentId.toString(),
          sessionId: session?.id ?? null,
          invoiceId: log.invoiceId ? log.invoiceId.toString() : null, // index data (F7)
          amount: usdt(record.gross), // what the payer paid: an invoice's includes the fee
          refunded: usdt(record.refunded),
          txHash: log.txHash, // index data (F7)
          paidAt: new Date(log.time).toISOString(), // index data (F7)
          reference: session?.reference ?? "",
        },
      ];
    });
    const next = rest.length > limit ? page[page.length - 1].paymentId.toString() : null;
    return Response.json({ data, next }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error(`payments list: ${error instanceof Error ? error.message : String(error)}`);
    return fail(503, "Payments can't be read right now. Please try again in a minute.");
  }
}
