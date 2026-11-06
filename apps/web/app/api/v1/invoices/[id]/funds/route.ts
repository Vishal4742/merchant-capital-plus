// GET /api/v1/invoices/:id/funds?payer=0x…: does this payer hold enough USDT for this invoice right now (FR-PAY-16)?
// The checkout's funds check for an invoice: what is still owed plus the fee on top, read on chain by our server like the
// pay route (FR-PRIV-1), for our shop's invoices only. The answer is one boolean: never the balance, never an address.
import { isAddress } from "viem";
import { merchantConfig, payConfig } from "../../../../../../lib/config.ts";
import { readInvoice, readRelayFee, readUsdtBalance } from "../../../../../../lib/onchain.ts";
import { clientIp, fail, handle, ok, sharedRateLimit } from "../../../../../../lib/server/http.ts";
import { isShopInvoice } from "../../../../../../lib/settle.ts";

const CHECKS_PER_MINUTE = 30; // per IP, shared with the checkout's check (the same key)
const READ_TRIES = 2; // a customer is waiting: fail fast
const NOT_READ = "We couldn't check the balance right now.";
const NOT_FOUND = "This invoice doesn't exist. Check the link with whoever sent it.";

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => handle(() => get(request, context));

async function get(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  // FR-OPS-9 (batch 049): one window across instances and restarts; a public balance check, so it stays up on this
  // instance's memory window if the database is down
  await sharedRateLimit(`funds:${clientIp(request)}`, CHECKS_PER_MINUTE, 60_000, "memory");
  const { id } = await params;
  if (!/^[1-9]\d{0,19}$/.test(id)) return fail(404, NOT_FOUND);
  const payer = new URL(request.url).searchParams.get("payer") ?? "";
  if (!isAddress(payer)) return fail(400, "payer must be an address.");
  const pay = payConfig();
  if (!pay) return fail(503, "Payments aren't live on this server yet.");
  const [invoice, fee, balance] = await Promise.all([
    readInvoice(pay.merchantPay, BigInt(id), { tries: READ_TRIES }).catch(() => null),
    readRelayFee(pay.merchantPay, { tries: READ_TRIES }).catch(() => null),
    readUsdtBalance(payer, { tries: READ_TRIES }).catch(() => null),
  ]);
  if (!invoice || fee === null || balance === null) return fail(503, NOT_READ);
  if (!isShopInvoice(invoice, merchantConfig()?.merchant)) return fail(404, NOT_FOUND);
  return ok({ enough: balance >= invoice.amount - invoice.paid + fee });
}
