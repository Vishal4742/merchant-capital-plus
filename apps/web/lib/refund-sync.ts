// After a dashboard refund's receipt, name the tx to the gateway so it sends payment.refunded (FR-GW-7, AT-15). The
// server trusts only MerchantPay's Refunded log in that receipt, so this call moves nothing; the refund already happened.
// A 502 or a network error means the server's RPC can't read the receipt yet, so it is tried again; any other answer
// (400 no refund in this tx, 401 signed out, 429) would only repeat. A 404 means the payment has no checkout record
// (an invoice paid on chain): no webhook will ever be sent for it, so there is nothing to report (security 027 F2).
const TRIES = 3;
const PAUSE_MS = 1_500;
const NOT_READABLE_YET = 502;
const NO_CHECKOUT = 404;

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** True once the gateway has the refund (or has no checkout to send it for); false if it still can't. Never throws:
 *  the money already moved. */
export async function syncRefund(
  paymentId: string,
  txHash: string,
  fetcher: Fetch = fetch,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    const status = await fetcher(`/api/v1/payments/${paymentId}/refunds/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx_hash: txHash }),
    }).then(
      (res) => res.status,
      () => NOT_READABLE_YET,
    );
    if ((status >= 200 && status < 300) || status === NO_CHECKOUT) return true;
    if (status !== NOT_READABLE_YET || attempt >= TRIES) return false;
    await wait(PAUSE_MS);
  }
}
