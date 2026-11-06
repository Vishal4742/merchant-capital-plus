// A mined transaction's fee never changes, so its receipt is read once and kept (NFR-5, NFR-13). Keyed by the tx hash
// alone: public chain data, the same for every merchant, so nothing one merchant may not see is ever shared. A failed or
// pending read throws, and a throw is never cached. Display only (the merchant's "network fee" column), never money.
// ponytail: the default in-memory cache, per server instance; 'use cache: remote' if cold instances still read too much.
import { cacheLife } from "next/cache";
import type { Hex } from "viem";
import { readTxFee } from "../onchain.ts";

export async function cachedTxFee(txHash: Hex): Promise<bigint> {
  "use cache";
  cacheLife("max");
  return readTxFee(txHash);
}
