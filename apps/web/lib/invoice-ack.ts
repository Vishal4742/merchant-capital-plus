// FR-INV-8 (batch 047): what the debtor signs to acknowledge an invoice. The browser builds it (lib/sign-sale.ts) and the
// server rebuilds it from the invoice it reads on chain (POST /api/v1/invoices/:id/acknowledge), never from the request.
// An EIP-712 message only: it moves no money and is never a transaction. Pure: no DOM, no network.
import type { Address } from "viem";
import { whitechainSepolia } from "viem/chains";

// packages/shared addresses.capitalMarket, pinned by test/invoice-ack.test.mjs (lib/server/capital.ts is server-only)
const CAPITAL_MARKET: Address = "0xecd63a369d23dfddc6bfac921e41a86760c20abe";

export const ackDomain = { name: "Merchant Capital+", version: "1", chainId: whitechainSepolia.id, verifyingContract: CAPITAL_MARKET } as const;

export const ackTypes = {
  InvoiceAck: [
    { name: "invoiceId", type: "uint256" },
    { name: "merchant", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "dueDate", type: "uint64" },
    { name: "debtor", type: "address" },
  ],
} as const;

/** The invoice as MerchantPay holds it: amount is the whole invoice in USDT base units, dueDate unix seconds. */
export interface AckTerms {
  invoiceId: bigint;
  merchant: Address;
  amount: bigint;
  dueDate: bigint;
}

export const ackTypedData = (terms: AckTerms, debtor: Address) => ({
  domain: ackDomain,
  types: ackTypes,
  primaryType: "InvoiceAck" as const,
  message: { invoiceId: terms.invoiceId, merchant: terms.merchant, amount: terms.amount, dueDate: terms.dueDate, debtor },
});
