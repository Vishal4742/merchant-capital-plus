// Adapted from Pixa (MIT) src/tools/pay.ts: a pay tool that checks the budget, signs a USDT EIP-3009 authorization,
// then records the spend. Changes for Merchant Capital+ (FR-MCP-5): it pays one gateway checkout instead of building
// an x402 header. The terms (merchant, order, amount, expiry) come from the hosted checkout page the gateway renders,
// the same props the browser signs from, never from the model; MerchantPay is pinned to packages/shared's address.
// The signed message is apps/web/lib/pay.ts saleAuthorization, as lib/sign-sale.ts signs it. The POST is never retried.
import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { encodeAbiParameters, isAddress, keccak256, toHex, type Address, type Hex } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import { z } from "zod";
import { KIND_SALE, addresses, chainId, nonceParams, receiveWithAuthorizationTypes, usdtDomain } from "../../../shared/contracts.ts";
import { checkoutId, explorer, usdt, type Reply } from "../common.ts";
import type { SpendingTracker } from "../spending.ts";

const SIGNATURE_WINDOW_S = 465; // apps/web/lib/pay.ts: inside the relayer's now+30 s … now+900 s window
const MIN_LEFT_MS = 60_000; // a checkout ending sooner can't fit the relayer's 30 s minimum plus the relay itself
const PAGE_TIMEOUT_MS = 15_000;
const PAY_TIMEOUT_MS = 120_000; // the pay route relays and then reads the chain
const PUSH = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g; // Next.js streams the page's props in these
const TERMS = "Couldn't read this checkout's payment terms from its page, so nothing was signed. Open the URL in a browser to pay.";

export interface CheckoutTerms {
  merchantPay: Address;
  merchant: Address;
  orderRef: Hex;
  amount: bigint; // USDT units due now (a link's discount code is already taken off)
  expiresAt: number; // ms
  paid: boolean;
  pending: boolean;
}

/** The Checkout component's props from the page's flight data (app/checkout/[sessionId]/page.tsx). A string the shop
 *  controls (name, reference) is JSON-escaped in there, so it can't fake a "sale" key. Throws when any term is missing. */
export function readCheckoutPage(html: string, id: string): CheckoutTerms {
  let flight: string;
  try {
    flight = [...html.matchAll(PUSH)].map((match) => JSON.parse(match[1]) as string).join("");
  } catch {
    throw new Error(TERMS);
  }
  const sale = /"sale":(\{[^{}]*\})/.exec(flight);
  const expiresAt = /"expiresAt":(\d{1,16})[,}]/.exec(flight);
  const paid = /"paid":(true|false)[,}]/.exec(flight);
  const pending = /"pending":(true|false)[,}]/.exec(flight);
  if (!sale || !expiresAt || !paid || !pending) throw new Error(TERMS);
  if (!flight.includes(`"sessionId":${JSON.stringify(id)}`)) throw new Error(`The page at that URL is not checkout ${id}. Nothing was signed.`);
  const terms = JSON.parse(sale[1]) as Record<string, unknown>;
  const { merchantPay, merchant, orderRef, amount } = terms;
  const valid =
    typeof merchantPay === "string" && isAddress(merchantPay) &&
    typeof merchant === "string" && isAddress(merchant) &&
    typeof orderRef === "string" && /^0x[0-9a-fA-F]{64}$/.test(orderRef) &&
    typeof amount === "string" && /^\d{1,30}$/.test(amount);
  if (!valid) throw new Error(TERMS);
  return { merchantPay, merchant, orderRef: orderRef as Hex, amount: BigInt(amount), expiresAt: Number(expiresAt[1]), paid: paid[1] === "true", pending: pending[1] === "true" };
}

export interface PayContext {
  account: PrivateKeyAccount;
  base: URL;
  fetch: typeof globalThis.fetch;
  now: () => number;
  spending: SpendingTracker;
  reply: Reply;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function readTerms(id: string, { base, fetch }: PayContext): Promise<CheckoutTerms> {
  const page = new URL(`/checkout/${id}`, base);
  const res = await fetch(page, { headers: { accept: "text/html" }, redirect: "error", signal: AbortSignal.timeout(PAGE_TIMEOUT_MS) }).catch((error: unknown) => {
    throw new Error(`Couldn't reach the gateway (${reason(error)}). Nothing was signed.`);
  });
  if (res.status === 404) throw new Error("No such checkout. Nothing was signed.");
  if (!res.ok) throw new Error(`The checkout page answered ${res.status}. Nothing was signed; try again in a minute.`);
  return readCheckoutPage(await res.text(), id);
}

/** USDT ReceiveWithAuthorization from the payer to MerchantPay for this sale; the nonce binds merchant, order, amount. */
async function signSale(terms: CheckoutTerms, { account, now }: PayContext) {
  const salt = toHex(randomBytes(32));
  const validBefore = BigInt(Math.min(Math.floor(now() / 1000) + SIGNATURE_WINDOW_S, Math.floor(terms.expiresAt / 1000)));
  const nonce = keccak256(encodeAbiParameters(nonceParams, [BigInt(chainId), addresses.merchantPay, KIND_SALE, BigInt(terms.merchant), terms.orderRef, terms.amount, salt]));
  const signature = await account.signTypedData({
    domain: usdtDomain,
    types: receiveWithAuthorizationTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: addresses.merchantPay, value: terms.amount, validAfter: 0n, validBefore, nonce },
  });
  return { from: account.address, salt, validBefore: validBefore.toString(), signature, amount: terms.amount.toString() };
}

async function payCheckout(input: string, ctx: PayContext) {
  const { base, fetch, now, spending } = ctx;
  const id = checkoutId(input, base);
  const terms = await readTerms(id, ctx);
  if (terms.merchantPay.toLowerCase() !== addresses.merchantPay.toLowerCase()) {
    throw new Error(`This checkout names a MerchantPay contract (${terms.merchantPay}) other than Merchant Capital+'s ${addresses.merchantPay}. Nothing was signed.`);
  }
  if (terms.paid) throw new Error("This checkout is already paid. Nothing was signed.");
  if (terms.pending) throw new Error("An earlier payment for this checkout is still being confirmed. Don't pay again; check it with get_checkout.");
  if (terms.expiresAt - now() < MIN_LEFT_MS) throw new Error("This checkout has expired or ends within a minute. Ask the shop for a new one.");

  const record = spending.begin(id, terms.amount); // the caps; recorded before anything is signed or sent
  let res: Response;
  try {
    const body = JSON.stringify(await signSale(terms, ctx));
    res = await fetch(new URL(`/api/v1/sessions/${id}/pay`, base), { method: "POST", headers: { "content-type": "application/json" }, body, redirect: "error", signal: AbortSignal.timeout(PAY_TIMEOUT_MS) });
  } catch (error) {
    spending.settle(record, "unknown"); // it may have reached the relayer: counted, never retried
    throw new Error(`No answer from the gateway (${reason(error)}). The payment may still go through: don't pay again; check it with get_checkout.`);
  }
  const json = (await res.json().catch(() => null)) as { error?: unknown; txHash?: unknown } | null;
  const said = typeof json?.error === "string" ? json.error : `The gateway answered ${res.status}.`;
  if (res.status >= 400 && res.status < 500) {
    spending.settle(record, "refused");
    throw new Error(`Payment refused: ${said}${/nothing was charged/i.test(said) ? "" : " Nothing was charged."}`);
  }
  if (!res.ok || !json) {
    spending.settle(record, "unknown");
    throw new Error(`Outcome unknown: ${said} Don't pay again; check it with get_checkout.`);
  }
  const txHash = typeof json.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(json.txHash) ? json.txHash : null;
  spending.settle(record, { txHash });
  return {
    paid: true,
    checkoutId: id,
    amount: usdt(terms.amount),
    currency: "USDT",
    from: ctx.account.address,
    txHash,
    explorer: explorer(txHash),
    ...(txHash ? {} : { note: "The gateway found this payment on chain but sent no tx hash; get_checkout shows it." }),
  };
}

export function registerPay(server: McpServer, ctx: PayContext): void {
  const { perPayment, perDay } = ctx.spending.limits;
  // one payment at a time, so two calls can't both pass the day cap (spending.ts)
  let queue: Promise<unknown> = Promise.resolve();
  server.registerTool(
    "pay_checkout",
    {
      title: "Pay a checkout",
      description:
        `Pay a Merchant Capital+ checkout from this assistant's own test wallet (${ctx.account.address}), gasless, in USDT on Whitechain testnet. ` +
        `The amount comes from the checkout itself. Limits: ${usdt(perPayment)} USDT per payment and ${usdt(perDay)} USDT per UTC day. ` +
        "This moves real test money: only pay a checkout the user asked you to pay.",
      inputSchema: { checkout: z.string().describe("The checkout URL (or id) on the gateway.") },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    ({ checkout }) => {
      const run = queue.then(() => ctx.reply(() => payCheckout(checkout, ctx)));
      queue = run.catch(() => undefined);
      return run;
    },
  );
}
