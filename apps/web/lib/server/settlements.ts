// Settlements (SRS FR-GW-10): T+0, each payment settles in its own tx, to the merchant's wallet (an advance's investors
// take their share in the same tx). Rows from MerchantPay's Paid logs; the balance card is the wallet's USDT on chain.
import type { Address } from "viem";
import { readUsdtBalance } from "../onchain.ts";
import { EXPLORER } from "../usdt.ts";
import { HttpError } from "./http.ts";
import { merchantHistory, paymentsIn, usdt, type Range } from "./reports.ts";

/** The wallet balance and one row per payment in range, newest first; `net` = what landed in the merchant's wallet. */
export async function settlements(merchantPay: Address, merchant: Address, range: Range) {
  const [history, balance] = await Promise.all([
    merchantHistory(merchantPay, merchant),
    readUsdtBalance(merchant).catch(() => {
      throw new HttpError(502, "The wallet balance isn't available right now. Try again in a minute.");
    }),
  ]);
  return {
    balance: usdt(balance),
    settlements: [...paymentsIn(history, range)].reverse().map((p) => ({
      payment_id: p.paymentId.toString(),
      gross: usdt(p.gross),
      fee: usdt(p.fee),
      to_investors: usdt(p.toInvestors),
      net: usdt(p.toMerchant),
      tx_hash: p.txHash,
      settled_at: new Date(p.time).toISOString(),
      explorer_url: p.txHash ? `${EXPLORER}/tx/${p.txHash}` : null,
    })),
  };
}
