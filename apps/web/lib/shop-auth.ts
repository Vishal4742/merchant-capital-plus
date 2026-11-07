// Who is calling the shop API (POST /api/v1/sessions, GET /api/v1/payments; SRS FR-GW-5, FR-GW-6): the demo shop's
// SHOP_API_KEY (until claude-sdk switches the shop to its own key), or a merchant's own secret key (sk_test_…), checked
// by authenticateKey. A publishable key (pk_test_…) is for the browser and gets 403 here. Server only.
import type { Address } from "viem";
import { merchantConfig, shopAuthorized } from "./config.ts";
import { DbUnavailable } from "./server/db.ts";
import { merchantName } from "./server/http.ts";
import { authenticateKey } from "./server/keys.ts";
import { internalCaller } from "./server/mcp-principal.ts";

export type Shop = { merchant: Address; merchantName: string };
export type Refusal = { status: number; error: string };

export async function shopCaller(request: Request): Promise<Shop | Refusal> {
  const config = merchantConfig();
  if (config && shopAuthorized(request, config.apiKey)) return { merchant: config.merchant, merchantName: config.merchantName };
  // an assistant connection reading payments (batch 058): the route's scope is checked against its grant
  const internal = await internalCaller(request).catch((error: unknown) => (error instanceof DbUnavailable ? { status: 401, error: "Missing or wrong API key." } : { status: 503, error: "We can't check this connection right now. Try again in a minute." }));
  if (internal) return "error" in internal ? { status: internal.status, error: internal.error } : { merchant: internal.merchant, merchantName: merchantName(internal.merchant) };
  let key: Awaited<ReturnType<typeof authenticateKey>>;
  try {
    key = await authenticateKey(request);
  } catch (error) {
    if (!(error instanceof DbUnavailable)) {
      console.error("shop key check:", error instanceof Error ? error.name : typeof error); // never the message (NFR-8)
      return { status: 503, error: "We can't check API keys right now. Try again in a minute." };
    }
    key = null; // no key database on this server: only SHOP_API_KEY can match
  }
  if (!key) return { status: 401, error: "Missing or wrong API key." };
  if (key.kind !== "sk") return { status: 403, error: "Use a secret key (sk_…) on your server." };
  return { merchant: key.merchant, merchantName: merchantName(key.merchant) };
}
