// Capital offers on Arkiv (FR-ARK-1..5, ARCHITECTURE §5): one mcplus.offer.v1 entity per offer, owned by our publisher
// key and expiring at the offer deadline. The chain stays the truth: `matches` is the Buy gate (FR-ARK-3).
import { ExpirationTime } from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import { addr, defineSchema, str, u64 } from "@arkiv-network/sdk/schema";
import type { Address, Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { arkivClients, redactArkivError } from "../arkiv.ts";
import { merchantConfig, payConfig } from "../config.ts";
import { CAPITAL_MARKET, chainOffers, offerJson, offerStatus, readOffer, type ChainOffer, type Deps, type OfferJson } from "./capital.ts";
import { HttpError } from "./http.ts";
import { ackView, acksFor, type InvoiceAck } from "./invoice-acks.ts";

export const OFFER_TYPE = "mcplus.offer.v1";
// The Arkiv attribute "chainId" (ARCHITECTURE §5) is quoted below: it names the offer's chain, always
// whitechainSepolia.id; test/test-mode's FR-GW-14 scan is for the chains the app signs and reads with.
const CHAIN_ID = BigInt(whitechainSepolia.id);
const YEAR_S = 365n * 86_400n;
const DAY_S = 86_400n;

// ARCHITECTURE §5's names, all indexed. No debtor at all (stricter than FR-ARK-4's "hashed"); the merchant's EIP-712
// `terms` signature is left out: the server publishes from the chain, which `matches` checks anyway.
export const OfferEntity = defineSchema(OFFER_TYPE, {
  kind: str().indexed(),
  "chainId": u64().indexed(),
  market: addr().indexed(),
  claimId: u64().indexed(),
  merchant: addr().indexed(),
  faceUsdt: u64().indexed(),
  priceUsdt: u64().indexed(),
  remainingUsdt: u64().indexed(),
  aprBps: u64().indexed(),
  holdbackBps: u64().indexed(),
  maturity: u64().indexed(),
  deadline: u64().indexed(),
  status: str().indexed(),
  sector: str().indexed(),
});

/** The terms as plain strings (addresses lowercased), the form both sides of `matches` compare in. */
export type OfferTerms = Record<keyof typeof COLUMN_KINDS, string>;
const COLUMN_KINDS = { kind: "str", "chainId": "u64", market: "addr", claimId: "u64", merchant: "addr", faceUsdt: "u64", priceUsdt: "u64", remainingUsdt: "u64", aprBps: "u64", holdbackBps: "u64", maturity: "u64", deadline: "u64", status: "str", sector: "str" } as const;
// The fixed terms of an offer. remainingUsdt and status change with every funding and may lag the chain (FR-ARK-5).
const TERMS = ["kind", "chainId", "market", "claimId", "merchant", "faceUsdt", "priceUsdt", "holdbackBps", "maturity", "deadline"] as const;

/** Investor's simple yearly return in bps, over deadline → maturity (at least a day): (face − price) / price. */
const aprBps = (o: ChainOffer) => {
  const term = BigInt(o.maturity - o.offerDeadline);
  return o.price === 0n ? 0n : ((o.face - o.price) * 10_000n * YEAR_S) / (o.price * (term > DAY_S ? term : DAY_S));
};

export function offerTerms(o: ChainOffer, now?: number): OfferTerms {
  return {
    kind: o.kind,
    "chainId": CHAIN_ID.toString(),
    market: CAPITAL_MARKET.toLowerCase(),
    claimId: o.claimId.toString(),
    merchant: o.merchant.toLowerCase(),
    faceUsdt: o.face.toString(),
    priceUsdt: o.price.toString(),
    remainingUsdt: (o.face - o.sold).toString(),
    aprBps: aprBps(o).toString(),
    holdbackBps: (o.kind === "advance" ? o.bps : 0).toString(),
    maturity: o.maturity.toString(),
    deadline: o.offerDeadline.toString(),
    status: offerStatus(o, now) ?? "closed",
    sector: "general",
  };
}

/** FR-ARK-3: every fixed term on Arkiv equals the chain. */
export const matches = (o: ChainOffer, terms: Partial<OfferTerms>) => {
  const chain = offerTerms(o);
  return TERMS.every((k) => terms[k] === chain[k]);
};

export interface OfferRow { entityKey: string; terms: Partial<OfferTerms> }
/** The three Arkiv operations the Capital server needs; tests pass a fake. */
export interface OfferStore {
  rows(): Promise<OfferRow[]>;
  create(terms: OfferTerms, expiresAt: number): Promise<string>;
  patch(entityKey: string, terms: OfferTerms): Promise<void>;
}
export type CapitalDeps = Deps & { arkiv?: OfferStore };

const MAX_ROWS = 1000;

function sdkValues(t: OfferTerms) {
  return {
    kind: str(t.kind), "chainId": u64(t.chainId), market: addr(t.market as Address), claimId: u64(t.claimId), merchant: addr(t.merchant as Address),
    faceUsdt: u64(t.faceUsdt), priceUsdt: u64(t.priceUsdt), remainingUsdt: u64(t.remainingUsdt), aprBps: u64(t.aprBps),
    holdbackBps: u64(t.holdbackBps), maturity: u64(t.maturity), deadline: u64(t.deadline), status: str(t.status), sector: str(t.sector),
  };
}

/** The live store: only entities our publisher key created AND owns count. Anyone can write an mcplus.offer.v1 entity,
 *  and an owner can hand an entity to us without our consent; the creator can't be changed (security 023 F2). */
function sdkStore(): OfferStore {
  const { reader, writer, address } = arkivClients();
  return {
    async rows() {
      const res = await reader.select().from(OfferEntity).where(eq("market", addr(CAPITAL_MARKET))).ownedBy(address).createdBy(address).limit(MAX_ROWS).fetch();
      return res.entities.map((e) => {
        const cells = e as unknown as Record<string, { value?: unknown } | undefined> & { $key: Hex };
        const terms = Object.fromEntries(Object.keys(COLUMN_KINDS).map((c) => [c, String(cells[c]?.value ?? "").toLowerCase()]));
        return { entityKey: cells.$key, terms: terms as Partial<OfferTerms> };
      });
    },
    async create(terms, expiresAt) {
      const created = await writer.createEntity(OfferEntity, sdkValues(terms), { expiration: ExpirationTime.atDate(new Date(expiresAt * 1000)) });
      return created.entityKey;
    },
    async patch(entityKey, terms) {
      await writer.patchEntity(OfferEntity, entityKey as Hex, { set: sdkValues(terms) });
    },
  };
}

const store = (deps: CapitalDeps) => deps.arkiv ?? sdkStore();
const redacted = (err: unknown) => redactArkivError(err, process.env.ARKIV_ACCESS_KEY).slice(0, 300);

const ROWS_TTL_MS = 10_000;
let rowsCache: { at: number; rows: Promise<OfferRow[]> } | undefined;

/** The live rows, single-flight and cached for 10 s, so book reads can't drain the Arkiv quota (security 023 F4). */
function liveRows(): Promise<OfferRow[]> {
  if (rowsCache && Date.now() - rowsCache.at < ROWS_TTL_MS) return rowsCache.rows;
  const entry = { at: Date.now(), rows: sdkStore().rows() };
  rowsCache = entry;
  entry.rows.catch(() => {
    if (rowsCache === entry) rowsCache = undefined; // a failed read is never cached
  });
  return entry.rows;
}

/** Our entities, or none if Arkiv can't be read: the book then shows with Buy disabled, never a blank page. */
async function offerRows(deps: CapitalDeps): Promise<OfferRow[]> {
  try {
    return await (deps.arkiv ? deps.arkiv.rows() : liveRows());
  } catch (err) {
    console.error(`capital: Arkiv offers unreadable, Buy disabled: ${redacted(err)}`);
    return [];
  }
}

/** The one rule the book and publish share: a row for this claim that matches the chain, else the first one. */
function rowFor(o: ChainOffer, rows: OfferRow[]): OfferRow | undefined {
  const mine = rows.filter((r) => r.terms.claimId === o.claimId.toString());
  return mine.find((r) => matches(o, r.terms)) ?? mine[0];
}

const sameTerms = (a: Partial<OfferTerms>, b: OfferTerms) => (Object.keys(COLUMN_KINDS) as (keyof OfferTerms)[]).every((k) => a[k] === b[k]);

/** Invoice offers that can have acks: our shop's (the pay page serves only its invoices, security 047 L1). */
const ackable = (o: ChainOffer, shop: Address | undefined) => o.kind === "invoice" && shop !== undefined && o.merchant.toLowerCase() === shop.toLowerCase();

/** The acks for these invoice offers (FR-INV-8), from our database. Unreadable: none, so the book still shows, every
 *  invoice as "Not acknowledged yet" (the safe side for an investor), and the log says why. */
async function debtorAcks(offers: ChainOffer[], shop: Address | undefined): Promise<Map<string, InvoiceAck[]>> {
  const merchantPay = payConfig()?.merchantPay;
  const ids = offers.filter((o) => ackable(o, shop)).map((o) => o.invoiceId);
  if (!merchantPay || ids.length === 0) return new Map();
  try {
    return await acksFor(merchantPay, ids);
  } catch (err) {
    console.error(`capital: debtor acks unreadable: ${err instanceof Error ? err.name : "error"}`); // never the message: it can hold SQL
    return new Map();
  }
}

/** GET /offers: the chain's offers in the book (AT-9 filtering), each with its Arkiv entity, the Buy gate and, for an
 *  invoice, its acks: only those signed for this offer's merchant, face and maturity (= the invoice's amount and due
 *  date, CapitalMarket.listInvoice), so an ack never attaches to terms it didn't sign (security 047 L1). Only the named
 *  customer wallet's ack reaches the book: anyone can ack an invoice that names no customer (ids are sequential), so an
 *  unchecked one never shows to investors (security round 2, M). The merchant's invoice list still shows those. */
export async function offerBook(deps: CapitalDeps = {}, now = Math.floor(Date.now() / 1000)): Promise<OfferJson[]> {
  const [offers, rows] = await Promise.all([chainOffers(deps), offerRows(deps)]);
  const listed = offers.filter((o) => offerStatus(o, now) !== null);
  const shop = merchantConfig()?.merchant;
  const acks = await debtorAcks(listed, shop);
  return listed.map((o) => {
    const row = rowFor(o, rows);
    const ack = ackable(o, shop) ? ackView(acks.get(o.invoiceId.toString()) ?? [], { merchant: o.merchant, amount: o.face, dueDate: BigInt(o.maturity) }) : null;
    return offerJson(o, now, row && { entityKey: row.entityKey, matches: matches(o, row.terms), terms: row.terms as Record<string, string> }, ack?.verified ? ack : undefined);
  });
}

/** Writes the offer's current chain state to Arkiv: patches our entity if anything changed (F5), or, for publish only,
 *  creates it while the offer is open (the after-funding refresh passes create: false, so a race with publish can't
 *  make two entities). It expires at maturity, so a funded offer keeps its entity until it repays (claude-contracts).
 *  Clients get fixed messages; the SDK's text goes to the log, redacted (F7). */
export async function syncOffer(o: ChainOffer, deps: CapitalDeps = {}, now = Math.floor(Date.now() / 1000), { create = true } = {}): Promise<{ entity_key: string } | null> {
  let s: OfferStore;
  try {
    s = store(deps);
  } catch (err) {
    console.error(`capital: Arkiv isn't set up: ${redacted(err)}`);
    throw new HttpError(503, "Arkiv isn't set up on this server.");
  }
  const terms = offerTerms(o, now);
  const arkivFailed = (err: unknown) => {
    console.error(`capital: Arkiv write for claim ${terms.claimId} failed: ${redacted(err)}`);
    return new HttpError(502, "Arkiv refused or timed out. Try again in a minute.");
  };
  let existing: OfferRow | undefined;
  try {
    existing = rowFor(o, await s.rows());
  } catch (err) {
    throw arkivFailed(err);
  }
  if (existing) {
    if (!sameTerms(existing.terms, terms)) {
      try {
        await s.patch(existing.entityKey, terms);
      } catch (err) {
        throw arkivFailed(err);
      }
      rowsCache = undefined;
    }
    return { entity_key: existing.entityKey };
  }
  if (!create) return null;
  if (offerStatus(o, now) !== "open") throw new HttpError(409, "Only an open offer can be published: this one is cancelled, past its deadline or sold out.");
  let entityKey: string;
  try {
    entityKey = await s.create(terms, o.maturity);
  } catch (err) {
    throw arkivFailed(err);
  }
  rowsCache = undefined;
  return { entity_key: entityKey };
}

/** POST /offers/{id}/publish: the signed-in merchant's own offer only (FR-ARK-1, FR-ARK-5). */
export async function publishOffer(merchant: Address, claimId: bigint, deps: CapitalDeps = {}, now = Math.floor(Date.now() / 1000)) {
  const o = await readOffer(claimId, deps);
  if (!o) throw new HttpError(404, "There's no offer with that id.");
  if (o.merchant.toLowerCase() !== merchant.toLowerCase()) throw new HttpError(403, "That offer belongs to another merchant.");
  return (await syncOffer(o, deps, now)) as { entity_key: string }; // create: true never returns null
}
