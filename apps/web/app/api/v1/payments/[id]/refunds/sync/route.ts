// POST /api/v1/payments/{id}/refunds/sync {tx_hash}: after the merchant refunds on chain, the dashboard names the tx and
// the gateway fires payment.refunded (FR-GW-7, FR-PAY-10, AT-15). The tx is only a pointer: lib/server/refunds.ts reads
// its receipt and trusts nothing but MerchantPay's own Refunded log for this payment. Another merchant's id is a 404.
import { isHash } from "viem";
import { HttpError, handle, ok, sharedRateLimit, readJson, signedInMerchant } from "../../../../../../../lib/server/http.ts";
import { syncRefund } from "../../../../../../../lib/server/refunds.ts";

const SYNCS_PER_MINUTE = 30;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const merchant = signedInMerchant(request);
    await sharedRateLimit(`refunds:${merchant.toLowerCase()}`, SYNCS_PER_MINUTE, 60_000, "closed");
    const { id } = await params;
    if (!/^[1-9]\d{0,77}$/.test(id)) throw new HttpError(400, "The payment id must be a MerchantPay payment number.");
    const { tx_hash: txHash } = await readJson(request);
    if (typeof txHash !== "string" || !isHash(txHash)) throw new HttpError(400, "tx_hash must be a transaction hash: 0x and 64 hex characters.");
    return ok(await syncRefund(merchant, BigInt(id), txHash));
  });
}
