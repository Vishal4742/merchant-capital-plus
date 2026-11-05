// Server-only settings, read from the environment (never NEXT_PUBLIC_: none of these go to the browser).
import { createHash, timingSafeEqual } from "node:crypto";
import { isAddress, type Address } from "viem";

export interface MerchantConfig {
  merchant: Address;
  merchantName: string;
  apiKey: string;
}

/** The demo shop (one merchant until the merchant dashboard adds API keys). Undefined if not configured. */
export function merchantConfig(): MerchantConfig | undefined {
  const merchant = process.env.MERCHANT_ADDRESS, apiKey = process.env.SHOP_API_KEY;
  if (!merchant || !isAddress(merchant) || !apiKey || apiKey.length < 24) return undefined;
  return { merchant, merchantName: process.env.MERCHANT_NAME || "Bandra Beans", apiKey };
}

/** MerchantPay and the relayer. Undefined until the contracts and relayer lanes ship Phase 2. */
export function payConfig(): { merchantPay: Address; relayerUrl: string } | undefined {
  const merchantPay = process.env.MERCHANT_PAY_ADDRESS, relayerUrl = process.env.RELAYER_URL;
  if (!merchantPay || !isAddress(merchantPay) || !relayerUrl) return undefined;
  return { merchantPay, relayerUrl };
}

/** True if the request carries the shop's secret key as a Bearer token (compared in constant time). */
export function shopAuthorized(request: Request, apiKey: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const given = createHash("sha256").update(auth.slice(7)).digest(), expected = createHash("sha256").update(apiKey).digest();
  return timingSafeEqual(given, expected);
}
