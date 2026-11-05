// Server-only Arkiv clients for Rabdi (ARCHITECTURE §5). The writer key lives only in the web app's env (NFR-3);
// never import this from a client component.
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const ARKIV_TIMEOUT_MS = 30_000;

/** Reader + writer on Rabdi. Errors name the variable, never its value. */
export function arkivClients(env: Record<string, string | undefined> = process.env) {
  // an empty key silently falls back to the heavily rate-limited public endpoint: refuse instead
  if (!env.ARKIV_ACCESS_KEY?.trim()) throw new Error("ARKIV_ACCESS_KEY is missing.");
  let account;
  try {
    account = privateKeyToAccount(env.ARKIV_PRIVATE_KEY as Hex); // checks hex, length and curve range
  } catch {
    // never pass the cause on: noble's message prints an out-of-range key as a number (review-code F1)
    throw new Error("ARKIV_PRIVATE_KEY is missing or malformed.");
  }
  const chain = rabdi({ accessKey: env.ARKIV_ACCESS_KEY });
  const transport = http(undefined, { timeout: ARKIV_TIMEOUT_MS });
  return {
    address: account.address,
    reader: createPublicClient({ chain, transport }),
    writer: createWalletClient({ chain, transport, account }),
  };
}

/** The SDK puts the access key in the RPC URL path, and viem copies that URL into error messages. */
export function redactArkivError(err: unknown, accessKey: string | undefined): string {
  let text = err instanceof Error ? err.message : String(err);
  if (accessKey) for (const s of [accessKey, encodeURIComponent(accessKey)]) text = text.replaceAll(s, "<access-key>");
  return text;
}
