// GET /api/v1/sessions/:id/funds?payer=0x…: does this payer hold enough USDT for this checkout right now (FR-PAY-16)?
// The sheet asks before the hold (the guest) and before a wallet's approval prompt, so a short balance is said up front,
// not after the hold. Our server reads the chain, never the browser (FR-PRIV-1). The answer is one boolean: never the
// balance, never an address. The amount is what is due now (a held discount code lowers it), as the pay route charges.
import { isAddress } from "viem";
import { readUsdtBalance } from "../../../../../../lib/onchain.ts";
import { clientIp, fail, handle, ok, rateLimit } from "../../../../../../lib/server/http.ts";
import { amountDue } from "../../../../../../lib/server/vouchers.ts";
import { getSession } from "../../../../../../lib/sessions.ts";

const CHECKS_PER_MINUTE = 30; // per IP: a sheet asks once on open, on "Check again" and per wallet attempt
const READ_TRIES = 2; // a customer is waiting: fail fast (the pay route checks the balance again anyway)
const NOT_READ = "We couldn't check the balance right now.";

export const GET = (request: Request, context: { params: Promise<{ id: string }> }) => handle(() => get(request, context));

async function get(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  rateLimit(`funds:${clientIp(request)}`, CHECKS_PER_MINUTE, 60_000);
  const payer = new URL(request.url).searchParams.get("payer") ?? "";
  if (!isAddress(payer)) return fail(400, "payer must be an address.");
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return fail(404, "This checkout doesn't exist.");
  const due = (await amountDue(id)) ?? session.amount; // null: a shop's own checkout, no code
  const balance = await readUsdtBalance(payer, { tries: READ_TRIES }).catch(() => null);
  if (balance === null) return fail(503, NOT_READ);
  return ok({ enough: balance >= due });
}
