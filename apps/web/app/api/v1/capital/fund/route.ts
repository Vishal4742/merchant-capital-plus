// POST /api/v1/capital/fund {claim_id, investor, units, valid_after, valid_before, salt, sig} → {tx_hash, block_number}:
// the investor's signed ReceiveWithAuthorization (value = quote, nonce = fundingNonce) relayed gaslessly (FR-ADV-3).
// The signature is the authorization, so no sign-in; errors are plain messages.
import { fundOffer } from "../../../../../lib/server/capital-fund.ts";
import { clientIp, handle, ok, rateLimit, readJson } from "../../../../../lib/server/http.ts";

export async function POST(request: Request) {
  return handle(async () => {
    rateLimit(`capital-fund:${clientIp(request)}`, 10, 60_000); // each call may become a relayed transaction
    return ok(await fundOffer(await readJson(request)));
  });
}
