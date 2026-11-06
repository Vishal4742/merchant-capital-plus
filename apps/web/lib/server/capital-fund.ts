// POST /api/v1/capital/fund (FR-ADV-3): gasless investor funding through the relayer's fund action (claude-relayer
// batch 010). Checked before relaying: a verified investor, an open offer, units left, the relayer's 1 USDT minimum.
import { after } from "next/server.js"; // the .js path resolves under Node's test runner too
import type { Hex } from "viem";
import { payConfig } from "../config.ts";
import { BUSY, NOT_FUNDED, UNKNOWN } from "../relay.ts";
import { syncOffer } from "./capital-arkiv.ts";
import { isVerifiedInvestor, offerStatus, parseFundBody, quoteUnits, readOffer, type Deps, type FundBody } from "./capital.ts";
import { HttpError, MIN_PAYMENT } from "./http.ts";

const RELAY_TIMEOUT_MS = 35_000; // longer than the relayer's receipt wait, as in lib/relay.ts
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const HASH = /^0x[0-9a-fA-F]{64}$/;

export type FundDeps = Deps & {
  fetch?: typeof fetch;
  relayerUrl?: string;
  secret?: string;
  schedule?: (task: () => Promise<void>) => void;
};

/** Checks the funding, relays it once, and refreshes the offer's Arkiv entity after the response (FR-ARK-5). */
export async function fundOffer(raw: Record<string, unknown>, deps: FundDeps = {}): Promise<{ tx_hash: Hex; block_number: string | null }> {
  const f = parseFundBody(raw);
  const relayerUrl = deps.relayerUrl ?? payConfig()?.relayerUrl;
  if (!relayerUrl) throw new HttpError(503, "Funding isn't set up on this server.");
  const [offer, verified] = await Promise.all([readOffer(f.claimId, deps), isVerifiedInvestor(f.investor, deps)]);
  if (!offer) throw new HttpError(404, "There's no offer with that id.");
  if (!verified) throw new HttpError(403, "This wallet isn't a verified investor yet, so it can't buy claims.");
  if (offerStatus(offer) !== "open") throw new HttpError(409, "This offer isn't open for funding any more.");
  const left = offer.face - offer.sold;
  if (f.units > left) throw new HttpError(400, `Only ${left} units are left in this offer.`);
  // no relay fee on funding, so the relayer refuses less than 1 USDT: say so instead of "approval didn't work"
  if ((await quoteUnits(f.claimId, f.units, deps)) < MIN_PAYMENT) throw new HttpError(400, "The minimum funding is 1.00 USDT.");
  const tx = await relayFunding(f, relayerUrl, deps);
  (deps.schedule ?? after)(async () => {
    try {
      const fresh = await readOffer(f.claimId, deps);
      if (fresh) await syncOffer(fresh, deps);
    } catch (err) {
      console.error(`capital: Arkiv refresh after funding claim ${f.claimId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return tx;
}

// ponytail: lib/relay.ts's transport rules (the secret only over https or loopback, no redirects, a 35 s timeout) and
// its messages, until that file exports relayFund (claude-frontend agreed 10:27); then call relayFund instead.
async function relayFunding(f: FundBody, relayerUrl: string, deps: FundDeps) {
  const url = new URL(relayerUrl);
  const secret = (deps.secret ?? process.env.RELAY_API_SECRET)?.trim();
  const safe = url.protocol === "https:" || LOOPBACK.has(url.hostname);
  const headers = { "content-type": "application/json", ...(secret && safe ? { "x-relay-secret": secret } : {}) };
  const args = { claimId: f.claimId.toString(), investor: f.investor, units: f.units.toString(), validAfter: "0", validBefore: f.validBefore.toString(), salt: f.salt };
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(new URL("/relay", relayerUrl), {
      method: "POST", headers, body: JSON.stringify({ action: "fund", args, sig: f.sig }), redirect: "manual", signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
    });
  } catch {
    throw new HttpError(504, UNKNOWN); // a timeout or a dropped connection: the relayer may have sent it
  }
  const data = (await res.json().catch(() => ({}))) as { txHash?: string; blockNumber?: string | number; code?: string };
  if (res.ok && typeof data.txHash === "string" && HASH.test(data.txHash)) {
    return { tx_hash: data.txHash as Hex, block_number: data.blockNumber === undefined ? null : String(data.blockNumber) };
  }
  if (res.status === 422 && data.code === "insufficient_funds") throw new HttpError(400, NOT_FUNDED);
  if (res.status === 422) throw new HttpError(400, "That approval didn't work. Nothing was charged; please try again.");
  // refused before sending: gas cap, pause, budget (503), the relayer's rate limit (429), or Vercel's burst protection
  const mitigated = res.status === 403 && res.headers.get("x-vercel-mitigated") !== null;
  if (res.status === 503 || res.status === 429 || mitigated) throw new HttpError(503, BUSY);
  if (res.status >= 500 || res.ok) throw new HttpError(504, UNKNOWN); // may have been sent
  throw new HttpError(400, "The funding didn't go through. Nothing was charged.");
}
