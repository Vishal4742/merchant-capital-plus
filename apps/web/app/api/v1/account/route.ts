// GET /api/v1/account: who the caller is and what this gateway supports (batch 052, FR-GW-16 proposed: the assistant
// connector's get_business_profile). The merchant comes from the credential only (session or sk_test_ key), never from
// a parameter. Everything else is this server's own configuration: no guesses, and `null` where main has no value yet
// (a business timezone arrives with Stage 3 workspaces, FR-BIZ-1; key scopes and expiry don't exist, FR-GW-6).
import { CURRENCIES, MAX_PAYMENT, MIN_PAYMENT, handle, merchantName, ok } from "../../../../lib/server/http.ts";
import { callerMerchant } from "../../../../lib/server/keys.ts";
import { EXPLORER, USDT, USDT_DECIMALS, plainUsdt } from "../../../../lib/usdt.ts";

const CHAIN_ID = 1874; // Whitechain Testnet (packages/shared/contracts.ts chainId; lib/usdt.ts's domain uses the same)

export async function GET(request: Request) {
  return handle(async () => {
    const caller = await callerMerchant(request);
    return ok({
      merchant: { address: caller.merchant, name: merchantName(caller.merchant) },
      environment: "test", // every key is sk_test_/pk_test_ and the chain is a testnet (FR-GW-14)
      network: { name: "Whitechain Testnet", chain_id: CHAIN_ID, explorer: EXPLORER },
      settlement: { asset: "USDT", token: USDT, decimals: USDT_DECIMALS },
      price_currencies: CURRENCIES, // a non-USDT price becomes USDT at a rate locked when the payer opens the checkout (FR-GW-11)
      payment_limits: { currency: "USDT", min: plainUsdt(MIN_PAYMENT), max: plainUsdt(MAX_PAYMENT) },
      payment_methods: [
        { id: "usdt_signature", label: "USDT on Whitechain Testnet: the payer signs one authorization at the hosted checkout and the relayer pays the gas" },
      ],
      timezone: null,
      credential: { type: caller.via, key_id: caller.keyId, scopes: null, expires_at: null },
      capabilities: { links: true, payments: true, reports: true, customers: false, invoices: false, reminders: false, operations: true },
    });
  });
}
