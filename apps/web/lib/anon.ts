// Browser-only. Every chain read the app makes in the browser goes through Anon-RPC (FR-PRIV-1).
import { createPublicClient, http } from "viem";
import { mainnet, whitechainSepolia } from "viem/chains";

type RpcProvider = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

const ANKR_1874 = "https://rpc.ankr.com/whitechain_testnet";
// Nym specifier contract on Ethereum mainnet (ARCHITECTURE.md §7). Choosing this address is choosing Nym.
const NYM_SPECIFIER = "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0";
// keccak256 of the Nym worker bundle we reviewed (on-chain workerHash() on 2026-11-05). The harness
// trusts whatever hash the bootstrap RPC returns, so we pin it: a lying RPC or a specifier-owner
// swap can't change the code that sees our reads. Update deliberately if Nym ships a new bundle.
export const NYM_WORKER_HASH = "0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8";
const WORKER_HASH_SELECTOR = "0x3898587d"; // workerHash()
// The one plain read: the harness reads the specifier on mainnet to find the worker bundle
// (a disclosed exclusion, FR-PRIV-4). Sends CORS *.
const BOOTSTRAP_RPC = "https://ethereum-rpc.publicnode.com";
// Per read attempt. A cold first read can take the 90 s boot plus two 60 s attempts (about 3.5 min).
const ANON_TIMEOUT_MS = 60_000;
// The harness has no boot or bundle-fetch timeout of its own; past this the boot counts as failed.
export const BOOT_DEADLINE_MS = 90_000;

export const TRANSPORT_LABEL = "Anon-RPC (Nym)";

/** Wraps the bootstrap provider so the worker hash it reports must equal the pinned one. */
export function pinWorkerHash(provider: RpcProvider): RpcProvider {
  return {
    async request(args) {
      const result = await provider.request(args);
      const call = args.params?.[0] as { data?: string } | undefined;
      const isHashRead = args.method === "eth_call" && call?.data?.toLowerCase().startsWith(WORKER_HASH_SELECTOR);
      if (isHashRead && String(result).toLowerCase() !== NYM_WORKER_HASH) {
        throw new Error("The private-read worker changed on-chain; refusing to run it.");
      }
      return result;
    },
  };
}

async function connect() {
  // Dynamic import: the harness touches `document` on construction, so it must never run during SSR.
  const { AnonRpcWorker } = await import("@anon-rpc/browser-harness");
  const bootstrap = createPublicClient({ chain: mainnet, transport: http(BOOTSTRAP_RPC) });
  const worker = new AnonRpcWorker({
    address: NYM_SPECIFIER,
    preExisting: { rpcProvider: pinWorkerHash({ request: (args) => bootstrap.request(args as never) }) },
  });
  // A failed or stalled boot must not stay cached. close() removes the iframe if it exists; with harness
  // 0.4.0 it can't stop a boot whose bundle arrives after the deadline (an orphan worker; report upstream).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Private connection timed out. Try again.")), BOOT_DEADLINE_MS);
  });
  try {
    await Promise.race([worker.ready, deadline]);
  } catch (error) {
    worker.close();
    throw error;
  } finally {
    clearTimeout(timer);
  }
  return createPublicClient({
    chain: whitechainSepolia,
    batch: { multicall: true },
    cacheTime: 0,
    transport: http(ANKR_1874, { fetchFn: worker.fetch, timeout: ANON_TIMEOUT_MS, retryCount: 1 }),
  });
}

let client: ReturnType<typeof connect> | undefined;

/** One shared Nym-backed client per page load; a failed boot is forgotten so the next call retries. */
export function getChainClient() {
  // ponytail: harness 0.4.0 has no public signal for a worker that dies after `ready`, so such a
  // worker stays cached until reload. Upgrade when the harness exposes one, or on the first report.
  client ??= connect().catch((error: unknown) => {
    client = undefined;
    throw error;
  });
  return client;
}
