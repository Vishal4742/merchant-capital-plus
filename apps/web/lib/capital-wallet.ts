// The Capital tab's investor side (docs/CAPITAL-TAB.md §2.1, §4 I0-I4). Pure rules first (tested in
// test/ui-capital-investor.test.mjs), then the browser-only wallet calls: connect on chain 1874, read eligibility, holders
// and holdings, and sign the EIP-3009 fund authorization that POST /api/v1/capital/fund relays. The investor never pays
// gas (CON-4): it signs once, and the relayer sends the transaction.
import {
  BaseError,
  UserRejectedRequestError,
  createWalletClient,
  custom,
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  toHex,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { whitechainSepolia } from "viem/chains";
import { connectMerchant } from "./merchant-wallet.ts";
import { SIGNATURE_WINDOW_S } from "./pay.ts";
import type { OfferJson } from "./server/capital.ts";
import { USDT, formatUsdt, receiveTypes, usdtDomain } from "./usdt.ts";

// packages/shared addresses and fragments, pinned by the test (lib/server/capital.ts is server-only)
export const CAPITAL_MARKET: Address = "0xecd63a369d23dfddc6bfac921e41a86760c20abe";
export const CLAIM_TOKEN: Address = "0xce9b171a5c485a41dced9d7f043733bddc26c388";
export const marketAbi = parseAbi([
  "function offerCount() view returns (uint256)",
  "function offers(uint256 claimId) view returns (uint8 kind, address merchant, uint64 offerDeadline, uint16 bps, bool cancelled, bool settled, uint256 invoiceId, uint128 face, uint128 price, uint64 maturity, uint128 sold)",
  "function outstanding(uint256 claimId) view returns (uint256)",
  "function owed(address) view returns (uint256)",
]);
export const tokenAbi = parseAbi([
  "function canReceive(address account) view returns (bool)",
  "function holdersOf(uint256 id) view returns (address[])",
  "function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
  "function claimState(uint256 id) view returns (uint64 lockFrom, bool frozen)",
]);
const usdtAbi = parseAbi(["function balanceOf(address owner) view returns (uint256)"]);

export type BookOffer = OfferJson;
export type Kind = BookOffer["kind"];

/** Investors per claim (batch 026, the server's HOLDER_CAP): every payout pays all holders in one relayed tx. */
export const HOLDER_CAP = { advance: 1, invoice: 2 } as const satisfies Record<Kind, number>;
export const holderCapMessage = (kind: Kind) => {
  const n = HOLDER_CAP[kind];
  return `This ${kind} already has ${n} investor${n === 1 ? "" : "s"}, the most one ${kind} can have.`;
};
/** No relay fee on funding, so the relayer refuses a funding below 1 USDT. */
export const MIN_FUND = 1_000_000n;
export const WAITING =
  "Your wallet is waiting for approval: only verified investors can buy claims. KYC is simulated on this demo, so ask the team to approve it.";
export const UNKNOWN_FUNDING = "We couldn't confirm this yet. Don't fund again; check Your claims in a few minutes.";
const FAILED = "The funding didn't go through. Nothing was charged.";

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type Slot = { kind: "free" } | { kind: "last"; units: bigint } | { kind: "full"; message: string };

/** The server's rule (capital-fund.ts): an existing holder may add any amount; a new investor needs a free slot, and the
 *  one taking the last slot buys everything left, so a small slice can't lock the claim against everyone else. */
export function slotRule(kind: Kind, holders: readonly string[], investor: string, unitsLeft: bigint): Slot {
  if (holders.some((h) => same(h, investor))) return { kind: "free" };
  if (holders.length >= HOLDER_CAP[kind]) return { kind: "full", message: holderCapMessage(kind) };
  return holders.length === HOLDER_CAP[kind] - 1 ? { kind: "last", units: unitsLeft } : { kind: "free" };
}

/** The smallest units whose cost, ceil(units × price / face), is at least 1 USDT. */
export const minUnits = (price: bigint, face: bigint) => (price === 0n ? 0n : ((MIN_FUND - 1n) * face) / price + 1n);

export interface Investor {
  account: string;
  eligible: boolean;
  /** holdersOf(claim) for this offer, once read. */
  holders?: readonly string[];
}

/** Why Buy is off for this offer, or null. Chain status first, then the Arkiv match (FR-ARK-3), then the wallet. */
export function buyBlocker(o: BookOffer, me?: Investor): string | null {
  if (o.status === "funded") return "Fully funded.";
  if (o.status !== "open") return "Closed.";
  if (!o.arkiv.entity_key) return "Not in the Arkiv offer book yet, so it can't be bought.";
  if (!o.arkiv.matches) return "This offer's terms on Arkiv don't match the chain, so it can't be bought.";
  if (!me) return null;
  if (!me.eligible) return WAITING;
  if (same(o.merchant, me.account)) return "A shop can't fund its own offer.";
  const slot = me.holders ? slotRule(o.kind, me.holders, me.account, BigInt(o.units_left)) : null;
  return slot?.kind === "full" ? slot.message : null;
}

const CENT = 10_000n; // 0.01 USDT in base units

/** A USDT figure in the house style's 2 decimals (UX review #33 M3); a minimum rounds up so following it always works.
 *  Exact 6-decimal figures stay on the line the investor approves. */
export function usdt2(units: bigint, round: "nearest" | "up" = "nearest"): string {
  return formatUsdt(((units + (round === "up" ? CENT - 1n : CENT / 2n)) / CENT) * CENT);
}

export const investorsLabel = (kind: Kind) => (HOLDER_CAP[kind] === 1 ? "1 investor" : `Up to ${HOLDER_CAP[kind]} investors`);

/** The line under the amount: the slot rule in plain words, then the range (UX review #33 M2). `isNew`: the wallet holds
 *  none of this claim yet. */
export function fundHint(kind: Kind, slot: Slot, isNew: boolean, unitsLeft: bigint, minLeft: bigint): string {
  if (slot.kind === "last") {
    return kind === "advance"
      ? `A cash advance takes one investor, so you buy all of it: ${formatUsdt(slot.units)} USDT.`
      : `An invoice takes at most ${HOLDER_CAP.invoice} investors and you'd be the last, so you buy everything left: ${formatUsdt(slot.units)} USDT.`;
  }
  const rule = isNew && kind === "invoice" ? `An invoice takes at most ${HOLDER_CAP.invoice} investors, and the second buys everything you leave. ` : "";
  return `${rule}Up to ${formatUsdt(unitsLeft)} USDT. The smallest buy is ${usdt2(minLeft, "up")} USDT, which costs 1.00 USDT.`;
}

/** What the row says in place of an Arkiv entity key, or null when it has one. A closed offer's entity expired at its
 *  deadline, as Arkiv intends, so it doesn't read as Arkiv being down; an open offer without one keeps the warning. */
export const arkivNote = (o: BookOffer): string | null =>
  o.arkiv.entity_key ? null : o.status === "closed" ? "Closed · Arkiv entry expired" : "Not on Arkiv";

/** Why this amount can't be bought, or null. `cost` and `balance` are null until read. `minLeft` = minUnits(price, face):
 *  a part buy must leave at least that, or the next investor, who must buy everything left, is refused (the server's rule). */
export function amountBlocker(units: bigint, unitsLeft: bigint, cost: bigint | null, balance: bigint | null, minLeft: bigint): string | null {
  if (units <= 0n) return "Enter how much you want to get back.";
  if (units > unitsLeft) return `Only ${formatUsdt(unitsLeft)} USDT is left in this offer.`;
  if (units < unitsLeft && unitsLeft - units < minLeft) return `Buy all ${formatUsdt(unitsLeft)} USDT, or leave at least ${usdt2(minLeft, "up")} USDT for the next investor.`;
  if (cost === null) return null;
  if (cost < MIN_FUND) return "The smallest buy costs 1.00 USDT.";
  if (balance !== null && balance < cost) return `Your wallet holds ${formatUsdt(balance)} USDT, less than the ${formatUsdt(cost)} USDT this costs.`;
  return null;
}

/** The investor's simple yearly return if it buys now and is repaid at maturity: (face − price) / price per year. */
export function aprPercent(price: bigint, face: bigint, maturity: number, now = Math.floor(Date.now() / 1000)) {
  const days = Math.max(1, Math.round((maturity - now) / 86_400));
  const pct = price === 0n ? 0 : (Number(face - price) / Number(price)) * (365 / days) * 100;
  return { pct: pct.toFixed(1), days };
}

const NONCE_PARAMS = parseAbiParameters("uint256 chainId, address market, uint256 claimId, address investor, uint256 units, bytes32 salt");

/** CapitalMarket.fundingNonce: keccak256(abi.encode(chainid, market, claimId, investor, units, salt)). */
export const fundingNonce = (claimId: bigint, investor: Address, units: bigint, salt: Hex): Hex =>
  keccak256(encodeAbiParameters(NONCE_PARAMS, [BigInt(whitechainSepolia.id), CAPITAL_MARKET, claimId, investor, units, salt]));

export interface FundTerms {
  claimId: bigint;
  investor: Address;
  units: bigint;
  salt: Hex;
  validBefore: bigint;
}

/** What the investor signs (§2.1): USDT's ReceiveWithAuthorization to CapitalMarket for exactly the quoted cost. */
export const fundingTypedData = (f: FundTerms & { cost: bigint }) => ({
  domain: usdtDomain,
  types: receiveTypes,
  primaryType: "ReceiveWithAuthorization" as const,
  message: { from: f.investor, to: CAPITAL_MARKET, value: f.cost, validAfter: 0n, validBefore: f.validBefore, nonce: fundingNonce(f.claimId, f.investor, f.units, f.salt) },
});

/** POST /api/v1/capital/fund's body. valid_after is always "0" (the server refuses anything else). */
export const fundBody = (f: FundTerms, sig: Hex) => ({
  claim_id: f.claimId.toString(),
  investor: f.investor,
  units: f.units.toString(),
  valid_after: "0",
  valid_before: f.validBefore.toString(),
  salt: f.salt,
  sig,
});

export type FundOutcome = { kind: "done"; txHash: Hex } | { kind: "unknown" } | { kind: "error"; message: string };

/** The fund route's answer. Any 5xx but 503 (busy, nothing sent), or a 200 without a hash, may have been sent: never
 *  offer "try again" then, or the investor signs and funds twice. */
export function fundOutcome(status: number, data: { tx_hash?: unknown; error?: unknown }): FundOutcome {
  if (status === 200 && typeof data.tx_hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(data.tx_hash)) return { kind: "done", txHash: data.tx_hash as Hex };
  if (status === 200 || (status >= 500 && status !== 503)) return { kind: "unknown" };
  return { kind: "error", message: typeof data.error === "string" ? data.error : FAILED };
}

/** Funded ids, as recorded in this browser, keep showing after the claim repays and burns (§4 I3). */
export function claimsToShow(ids: readonly bigint[], balances: readonly bigint[], funded: Record<string, string>): bigint[] {
  return ids.filter((id, i) => (balances[i] ?? 0n) > 0n || id.toString() in funded);
}

// ---- browser-only from here ----

const NO_WALLET = "No browser wallet found. Install MetaMask or a similar wallet, then try again.";
const NO_ACCOUNT = "Your wallet didn't share an account. Unlock it, pick an account, then try again.";
const UNKNOWN_CHAIN = 4902; // EIP-3085: the wallet doesn't know chain 1874 yet

/** The wallet is on another chain; `account` is the one it shared. */
export class WrongNetwork extends Error {
  readonly account: Address; // a plain field: Node's type stripping can't run TS parameter properties
  constructor(account: Address) {
    super("Switch your wallet to Whitechain Testnet, then try again.");
    this.account = account;
  }
}

export type InvestorWallet = Awaited<ReturnType<typeof connectMerchant>> & { provider: EIP1193Provider };

/** The investor's wallet on chain 1874, or null when `prompt` is off and no account is shared yet (a silent reconnect on
 *  load never switches chains: it throws WrongNetwork instead). */
export async function connectInvestor(provider: EIP1193Provider | undefined, { prompt = true } = {}): Promise<InvestorWallet | null> {
  if (!provider) {
    if (!prompt) return null;
    throw new Error(NO_WALLET);
  }
  const wallet = createWalletClient({ chain: whitechainSepolia, transport: custom(provider) });
  const [account] = prompt ? await wallet.requestAddresses() : await wallet.getAddresses();
  if (!account) {
    if (!prompt) return null;
    throw new Error(NO_ACCOUNT);
  }
  if ((await wallet.getChainId()) !== whitechainSepolia.id) {
    if (!prompt) throw new WrongNetwork(account);
    await wallet.switchChain({ id: whitechainSepolia.id }).catch(async (error: unknown) => {
      if (!(error instanceof BaseError) || !error.walk((e) => (e as { code?: number }).code === UNKNOWN_CHAIN)) throw new WrongNetwork(account);
      await wallet.addChain({ chain: whitechainSepolia }).catch(() => {
        throw new WrongNetwork(account);
      });
    });
  }
  // connectMerchant brings the private-first reader (Anon-RPC once booted, counted on the meter); its account check is
  // against the account the wallet just shared, so it always passes here
  return { ...(await connectMerchant(provider, account, CAPITAL_MARKET)), provider };
}

/** Eligibility (ClaimToken.canReceive, as the fund route checks it) and the USDT balance. */
export async function readInvestor(w: InvestorWallet) {
  const [eligible, balance] = await Promise.all([
    w.reader.readContract({ address: CLAIM_TOKEN, abi: tokenAbi, functionName: "canReceive", args: [w.account] }),
    w.reader.readContract({ address: USDT, abi: usdtAbi, functionName: "balanceOf", args: [w.account] }),
  ]);
  return { eligible, balance };
}

export const readHolders = (w: InvestorWallet, claimId: bigint) =>
  w.reader.readContract({ address: CLAIM_TOKEN, abi: tokenAbi, functionName: "holdersOf", args: [claimId] });

/** Signs the fund authorization for exactly `cost` (the contract's quote) and returns the fund route's body. The wallet's
 *  account and chain are read again first, so a switched account can't sign for the wrong `from`. */
export async function signFunding(w: InvestorWallet, f: { claimId: bigint; units: bigint; cost: bigint }) {
  const [current] = (await w.provider.request({ method: "eth_accounts" })) as string[];
  if (!current || !same(current, w.account)) throw new Error("Your wallet switched accounts. Connect again, then buy.");
  if ((await w.wallet.getChainId()) !== whitechainSepolia.id) throw new WrongNetwork(w.account);
  const terms: FundTerms = {
    claimId: f.claimId,
    investor: w.account,
    units: f.units,
    salt: toHex(crypto.getRandomValues(new Uint8Array(32))),
    validBefore: BigInt(Math.floor(Date.now() / 1000) + SIGNATURE_WINDOW_S),
  };
  const sig = await w.wallet.signTypedData({ account: w.account, ...fundingTypedData({ ...terms, cost: f.cost }) });
  return fundBody(terms, sig);
}

/** POST /api/v1/capital/fund. A dropped connection may still have reached the server, so it is unknown, not failed. */
export async function postFunding(body: ReturnType<typeof fundBody>): Promise<FundOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/v1/capital/fund", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { kind: "unknown" };
  }
  return fundOutcome(res.status, await res.json().catch(() => ({})));
}

const fundedKey = (account: string) => `mcplus.capitalFunded.${CAPITAL_MARKET}.${account.toLowerCase()}`;

/** The claim ids (and units) this browser funded: a per-viewer convenience, so a repaid claim can say "Repaid in full". */
export function fundedClaims(account: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(fundedKey(account)) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, string>) : {};
  } catch {
    return {}; // storage blocked or unreadable: show held claims only
  }
}

export function recordFunding(account: string, claimId: string, units: bigint) {
  const all = fundedClaims(account);
  try {
    localStorage.setItem(fundedKey(account), JSON.stringify({ ...all, [claimId]: (BigInt(all[claimId] ?? "0") + units).toString() }));
  } catch {
    // storage blocked: holdings still show every claim with units
  }
}

const MAX_CLAIMS = 200; // ponytail: the newest 200 offers, as the server's book; page when testnet lists more

export interface Holding {
  id: bigint;
  kind: Kind;
  held: bigint;
  /** Units this browser funded, or null if it didn't record any. */
  funded: bigint | null;
  outstanding: bigint;
  maturity: number;
  settled: boolean;
  lockFrom: number;
  frozen: boolean;
}

/** The investor's claims (G6: no route; browser reads, counted on the meter) and what the market holds for it. */
export async function readHoldings(w: InvestorWallet): Promise<{ holdings: Holding[]; owed: bigint }> {
  const market = { address: CAPITAL_MARKET, abi: marketAbi } as const;
  const token = { address: CLAIM_TOKEN, abi: tokenAbi } as const;
  const count = Number(await w.reader.readContract({ ...market, functionName: "offerCount" }));
  const first = Math.max(1, count - MAX_CLAIMS + 1);
  const ids = Array.from({ length: Math.max(0, count - first + 1) }, (_, i) => BigInt(first + i));
  const [balances, owed] = await Promise.all([
    ids.length ? w.reader.readContract({ ...token, functionName: "balanceOfBatch", args: [ids.map(() => w.account), ids] }) : Promise.resolve([] as readonly bigint[]),
    w.reader.readContract({ ...market, functionName: "owed", args: [w.account] }),
  ]);
  const funded = fundedClaims(w.account);
  const holdings = await Promise.all(
    claimsToShow(ids, balances, funded).map(async (id): Promise<Holding> => {
      const [offer, outstanding, [lockFrom, frozen]] = await Promise.all([
        w.reader.readContract({ ...market, functionName: "offers", args: [id] }),
        w.reader.readContract({ ...market, functionName: "outstanding", args: [id] }),
        w.reader.readContract({ ...token, functionName: "claimState", args: [id] }),
      ]);
      const [kind, , , , , settled, , , , maturity] = offer;
      return {
        id,
        kind: kind === 2 ? "advance" : "invoice",
        held: balances[ids.indexOf(id)] ?? 0n,
        funded: id.toString() in funded ? BigInt(funded[id.toString()]) : null,
        outstanding,
        maturity: Number(maturity),
        settled,
        lockFrom: Number(lockFrom),
        frozen,
      };
    }),
  );
  return { holdings, owed };
}

/** Any error from the calls above, as one plain sentence for the investor (no gas or WBT: investors never pay it). */
export function investorError(error: unknown): string {
  if (error instanceof WrongNetwork) return error.message;
  const rejected = (e: unknown) => e instanceof UserRejectedRequestError || (e as { code?: unknown }).code === 4001;
  if (rejected(error) || (error instanceof BaseError && error.walk(rejected))) return "You cancelled the request in your wallet.";
  if (error instanceof BaseError) return "We couldn't reach your wallet or the chain just now. Try again.";
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}
