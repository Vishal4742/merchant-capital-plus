// Capital tab server (P5, batch 023): CapitalMarket + ClaimToken reads behind /api/v1/capital/* (claude-contracts' 08:53
// API shape). Server-only. The chain is the source of truth; Arkiv only mirrors it (capital-arkiv.ts).
import { createPublicClient, encodeAbiParameters, getAddress, http, isAddress, keccak256, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { plainUsdt } from "../usdt.ts";
import { HttpError, merchantName } from "./http.ts";

// packages/shared addresses (contracts frozen 03:05). test/capital-core pins them and these fragments to the shared ABI;
// importing packages/shared from Next needs turbopack.root outside apps/web (the lib/onchain.ts reason).
export const CAPITAL_MARKET: Address = "0xecd63a369d23dfddc6bfac921e41a86760c20abe";
export const CLAIM_TOKEN: Address = "0xce9b171a5c485a41dced9d7f043733bddc26c388";

export const capitalAbi = parseAbi([
  "function offerCount() view returns (uint256)",
  "function offers(uint256 claimId) view returns (uint8 kind, address merchant, uint64 offerDeadline, uint16 bps, bool cancelled, bool settled, uint256 invoiceId, uint128 face, uint128 price, uint64 maturity, uint128 sold)",
  "function quote(uint256 claimId, uint256 units) view returns (uint256)",
  "function advanceOf(address merchant) view returns (uint256)",
  "function outstanding(uint256 claimId) view returns (uint256)",
  "function fundingNonce(uint256 claimId, address investor, uint256 units, bytes32 salt) view returns (bytes32)",
]);
export const claimAbi = parseAbi([
  "function claimState(uint256 id) view returns (uint64 lockFrom, bool frozen)",
  "function canSend(address account) view returns (bool)",
  "function canReceive(address account) view returns (bool)",
  "function getFrozenTokens(address account, uint256 id) view returns (uint256)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function holdersOf(uint256 id) view returns (address[])",
  "function MAX_HOLDERS() view returns (uint256)",
]);

type ReadRequest = { address: Address; abi: typeof capitalAbi | typeof claimAbi; functionName: string; args: readonly unknown[] };
export type Read = (req: ReadRequest) => Promise<unknown>;
export type Deps = { read?: Read };

const ANKR_1874 = "https://rpc.ankr.com/whitechain_testnet";
// multicall batching: the book's offers(id) reads and the transfer check's eight reads go out as one eth_call each
const makeClient = () => createPublicClient({ chain: whitechainSepolia, batch: { multicall: true }, transport: http(ANKR_1874, { timeout: 10_000, retryCount: 2 }) });
let client: ReturnType<typeof makeClient> | undefined;
const defaultRead: Read = (req) => (client ??= makeClient()).readContract(req as Parameters<ReturnType<typeof makeClient>["readContract"]>[0]);

const market = (read: Read, functionName: string, args: readonly unknown[] = []) => read({ address: CAPITAL_MARKET, abi: capitalAbi, functionName, args });
const token = (read: Read, functionName: string, args: readonly unknown[] = []) => read({ address: CLAIM_TOKEN, abi: claimAbi, functionName, args });
const nowSeconds = () => Math.floor(Date.now() / 1000);
const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();

/** CapitalMarket.offers(claimId), with `face`, `price` and `sold` in claim units (1 unit = 0.000001 USDT owed). */
export interface ChainOffer {
  claimId: bigint;
  kind: "invoice" | "advance";
  merchant: Address;
  offerDeadline: number;
  bps: number; // advance: holdback on gross; invoice: recourse
  cancelled: boolean;
  settled: boolean;
  invoiceId: bigint;
  face: bigint; // invoice amount, or the advance's cap
  price: bigint; // what investors pay for all face units: invoice price, or the advance's principal
  maturity: number;
  sold: bigint;
}

const KINDS: Record<number, ChainOffer["kind"]> = { 1: "invoice", 2: "advance" }; // OFFER_INVOICE, OFFER_ADVANCE

/** The offer, or null if there is none with that id. */
export async function readOffer(claimId: bigint, { read = defaultRead }: Deps = {}): Promise<ChainOffer | null> {
  const [kind, merchant, offerDeadline, bps, cancelled, settled, invoiceId, face, price, maturity, sold] = (await market(read, "offers", [claimId])) as [number, Address, bigint, number, boolean, boolean, bigint, bigint, bigint, bigint, bigint];
  const name = KINDS[Number(kind)];
  if (!name) return null;
  return { claimId, kind: name, merchant: getAddress(merchant), offerDeadline: Number(offerDeadline), bps: Number(bps), cancelled, settled, invoiceId, face, price, maturity: Number(maturity), sold };
}

const MAX_OFFERS = 200; // ponytail: the newest 200 offers; page the book when testnet ever lists more

/** Every offer on chain (the newest MAX_OFFERS), oldest first. */
export async function chainOffers({ read = defaultRead }: Deps = {}): Promise<ChainOffer[]> {
  const count = Number(await market(read, "offerCount"));
  const first = Math.max(1, count - MAX_OFFERS + 1);
  const ids = Array.from({ length: Math.max(0, count - first + 1) }, (_, i) => BigInt(first + i));
  const offers = await Promise.all(ids.map((id) => readOffer(id, { read })));
  return offers.filter((o): o is ChainOffer => o !== null);
}

export type OfferStatus = "open" | "funded" | "closed";

/** null = not in the book: cancelled, or past its deadline with units left (CapitalMarket refuses it; AT-9). */
export function offerStatus(o: ChainOffer, now = nowSeconds()): OfferStatus | null {
  if (o.cancelled) return null;
  if (o.settled) return "closed";
  if (o.sold === o.face) return "funded";
  return now > o.offerDeadline ? null : "open";
}

/** Our Arkiv entity for an offer: its key, the Buy gate, and its own values (claude-contracts D3: null when none). */
export interface ArkivMatch { entityKey: string; matches: boolean; terms: Record<string, string> }

/** claude-contracts' 08:53 offer shape with the 10:49 decisions: face and price always (an advance's face is its cap),
 *  principal and cap for advances only, holdback_pct 0 for invoices (Q12); arkiv.terms is the entity's values (D3). */
export function offerJson(o: ChainOffer, now = nowSeconds(), arkiv?: ArkivMatch) {
  const advance = o.kind === "advance";
  return {
    id: o.claimId.toString(),
    kind: o.kind,
    merchant: o.merchant,
    merchant_name: merchantName(o.merchant),
    principal: advance ? plainUsdt(o.price) : null,
    face: plainUsdt(o.face),
    price: plainUsdt(o.price),
    cap: advance ? plainUsdt(o.face) : null,
    holdback_pct: advance ? o.bps / 100 : 0,
    maturity: iso(o.maturity),
    offer_deadline: iso(o.offerDeadline),
    units_left: (o.face - o.sold).toString(),
    status: offerStatus(o, now),
    arkiv: { entity_key: arkiv?.entityKey ?? null, matches: arkiv?.matches ?? false, terms: arkiv?.terms ?? null },
  };
}
export type OfferJson = ReturnType<typeof offerJson>;

/** CapitalMarket.quote(claimId, units): the USDT the investor pays, shown before signing (FR-ADV-6). */
export async function quoteCost(claimId: bigint, units: bigint, { read = defaultRead }: Deps = {}): Promise<string> {
  if (!(await readOffer(claimId, { read }))) throw new HttpError(404, "There's no offer with that id.");
  return plainUsdt((await market(read, "quote", [claimId, units])) as bigint);
}

/** Investors per invoice claim: a full repayment pays them all in one tx under the relayer's 400k gas (contracts Q19). */
export const MAX_INVOICE_HOLDERS = 2;

export interface TransferCheck { allowed: boolean; reason: string | null }

/**
 * Whether `from` can transfer `amount` units of `claimId` to `to`, and the first rule that fails, in ClaimToken's own
 * order: _checkTransfer (claim movable, sender eligible, receiver eligible, unfrozen units), then ERC-1155's balance
 * check, then the holder cap in _move (FR-TOK-8; the AT-8 UI half shows the reason before any wallet prompt).
 */
export async function transferCheck(t: { from: Address; to: Address; claimId: bigint; amount: bigint }, { read = defaultRead }: Deps = {}): Promise<TransferCheck> {
  const [state, canSend, canReceive, frozenUnits, balance, toBalance, holders, maxHolders, offer] = (await Promise.all([
    token(read, "claimState", [t.claimId]),
    token(read, "canSend", [t.from]),
    token(read, "canReceive", [t.to]),
    token(read, "getFrozenTokens", [t.from, t.claimId]),
    token(read, "balanceOf", [t.from, t.claimId]),
    token(read, "balanceOf", [t.to, t.claimId]),
    token(read, "holdersOf", [t.claimId]),
    token(read, "MAX_HOLDERS"),
    readOffer(t.claimId, { read }),
  ])) as [[bigint, boolean], boolean, boolean, bigint, bigint, bigint, readonly Address[], bigint, ChainOffer | null];
  const [lockFrom, frozen] = state;
  const no = (reason: string): TransferCheck => ({ allowed: false, reason });
  const unfrozen = balance > frozenUnits ? balance - frozenUnits : 0n;
  if (frozen) return no("This claim is frozen by compliance, so its units can't move.");
  if (lockFrom !== 0n && BigInt(nowSeconds()) >= lockFrom) return no("This claim is locked for repayment: its units can't move this close to maturity.");
  if (!canSend) return no("The sender isn't a verified investor, so it can't send claim units.");
  if (!canReceive) return no("The receiver isn't a verified investor, so it can't hold claim units.");
  if (t.amount > unfrozen && t.amount <= balance) return no(`Only ${unfrozen} of the sender's ${balance} units are unfrozen.`);
  if (t.amount > balance) return no(`The sender's balance is too small: it holds ${balance} units.`);
  const fits = (cap: bigint) => t.amount === 0n || toBalance !== 0n || BigInt(holders.length) < cap || t.amount === balance;
  if (!fits(maxHolders)) return no(`This claim already has the maximum of ${maxHolders} holders.`);
  // the product's own rule after the contract's (security 022 M1): an invoice repayment pays every holder in one tx
  if (offer?.kind === "invoice" && !fits(BigInt(MAX_INVOICE_HOLDERS))) return no(`This invoice already has ${MAX_INVOICE_HOLDERS} investors, the most one invoice can have.`);
  return { allowed: true, reason: null };
}

const FUNDING_NONCE_PARAMS = parseAbiParameters("uint256 chainId, address market, uint256 claimId, address investor, uint256 units, bytes32 salt");

/** CapitalMarket.fundingNonce, computed locally: keccak256(abi.encode(block.chainid, market, claimId, investor, units, salt)). */
export const fundingNonce = (claimId: bigint, investor: Address, units: bigint, salt: Hex): Hex =>
  keccak256(encodeAbiParameters(FUNDING_NONCE_PARAMS, [BigInt(whitechainSepolia.id), CAPITAL_MARKET, claimId, investor, units, salt]));

/** InvestorRegistry eligibility as ClaimToken reads it (canReceive): only verified investors can hold claim units. */
export async function isVerifiedInvestor(account: Address, { read = defaultRead }: Deps = {}): Promise<boolean> {
  return (await token(read, "canReceive", [account])) as boolean;
}

/** ClaimToken.holdersOf(claimId): who holds units of this claim now. */
export const claimHolders = async (claimId: bigint, { read = defaultRead }: Deps = {}) => (await token(read, "holdersOf", [claimId])) as readonly Address[];

/** CapitalMarket.quote in USDT base units (quoteCost formats it). */
export const quoteUnits = async (claimId: bigint, units: bigint, { read = defaultRead }: Deps = {}) => (await market(read, "quote", [claimId, units])) as bigint;

/** The merchant's running advance (FR-ADV-1), or null: what is still owed, the cap and the holdback. */
export async function merchantAdvance(merchant: Address, { read = defaultRead }: Deps = {}) {
  const claimId = (await market(read, "advanceOf", [merchant])) as bigint;
  if (claimId === 0n) return null;
  const [offer, outstanding] = await Promise.all([readOffer(claimId, { read }), market(read, "outstanding", [claimId]) as Promise<bigint>]);
  if (!offer) return null;
  return { claim_id: claimId.toString(), outstanding: plainUsdt(outstanding), cap: plainUsdt(offer.face), holdback_pct: offer.bps / 100 };
}

const UINT = /^\d{1,78}$/;
const MAX_UINT256 = 2n ** 256n - 1n;

/** A uint256 sent as a decimal string, like the rest of the API. */
export function uintField(value: unknown, name: string, { positive = false } = {}): bigint {
  if (typeof value !== "string" || !UINT.test(value) || BigInt(value) > MAX_UINT256) throw new HttpError(400, `${name} must be a whole number, sent as a string.`);
  const n = BigInt(value);
  if (positive && n === 0n) throw new HttpError(400, `${name} must be above 0.`);
  return n;
}

export function addressField(value: unknown, name: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new HttpError(400, `${name} must be a 0x address.`);
  return getAddress(value);
}

export interface FundBody { claimId: bigint; investor: Address; units: bigint; validBefore: bigint; salt: Hex; sig: Hex }

/** POST /fund's body, checked before any relay. valid_after must be "0": lib/relay.ts always sends validAfter 0. */
export function parseFundBody(body: Record<string, unknown>): FundBody {
  const claimId = uintField(body.claim_id, "claim_id", { positive: true });
  const investor = addressField(body.investor, "investor");
  const units = uintField(body.units, "units", { positive: true });
  if (body.valid_after !== "0") throw new HttpError(400, 'valid_after must be "0": sign the funding valid from now.');
  const validBefore = uintField(body.valid_before, "valid_before", { positive: true });
  if (typeof body.salt !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.salt)) throw new HttpError(400, "salt must be 32 bytes of hex.");
  if (typeof body.sig !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(body.sig)) throw new HttpError(400, "sig must be a 65-byte signature in hex.");
  return { claimId, investor, units, validBefore, salt: body.salt as Hex, sig: body.sig as Hex };
}
