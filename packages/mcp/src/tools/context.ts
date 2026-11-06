// What every tool shares (batch 052): the client, the operation journal, the reply path, the business profile (cached
// a minute) with its time zone, the capability gate, URL trust, and the one write path: a journaled Idempotency-Key
// bound to the authenticated merchant (FR-MCP-15, production review F2) and a check that the reply matches the
// request before anything is called a success (F3).
import { ApiError, type Result, type WhiteflowClient } from "../client.ts";
import type { Account } from "../contract.ts";
import { dateIn, labelled } from "../dates.ts";
import { Journal, JournalRefusal, SERVER_RETENTION_MS } from "../journal.ts";
import type { Mode } from "../config.ts";
import { ToolRefusal, type Logger, type Reply } from "../safety.ts";

const PROFILE_TTL_MS = 60_000;
export const EXPLORER_TX = "https://explorer.testnet.whitechain.io/tx/";
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,100}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export type Capability = Exclude<keyof Account["capabilities"], "operations" | "approvals">;

export interface Profile {
  account: Account;
  zone: string;
  zoneSource: "business profile" | "connector setting (WHITEFLOW_TIMEZONE)" | "default (UTC): set WHITEFLOW_TIMEZONE";
  today: string;
  scope: string; // the journal scope: backend + environment + merchant, as authenticated
}

/** A reply that doesn't match what was asked (production review F3). */
export class Mismatch extends Error {}

export interface WriteOptions {
  key?: string;
  createAnother?: boolean;
}
export interface Written<T> extends Result<T> {
  key: string;
  source: "caller" | "resumed" | "replay" | "new";
}

export interface Ctx {
  mode: Mode;
  client: WhiteflowClient;
  journal: Journal;
  reply: Reply;
  log: Logger;
  now: () => number;
  configuredZone: string | null;
  trustedOrigins: string[];
  profile(): Promise<Profile>;
  require(capability: Capability, what: string): Promise<Profile>;
  /** An absolute https URL on a trusted WhiteFlow origin, or a Mismatch. Relative paths resolve on the gateway. */
  trustedUrl(value: string, what: string): string;
  write<T>(op: string, payload: unknown, opts: WriteOptions, send: (key: string) => Promise<Result<T>>, verify?: (data: T) => void): Promise<Written<T>>;
}

const iso = (ms: number) => new Date(ms).toISOString();
export const NEXT_RECONCILE =
  "Check get_operation_status and the records themselves (get_payment_link, list_invoices, list_payments). If nothing was created, call again with create_another: true; if it was, use that record.";

export function makeContext(base: Omit<Ctx, "profile" | "require" | "write" | "trustedUrl">): Ctx {
  let cached: { at: number; profile: Profile } | null = null;
  const ctx: Ctx = {
    ...base,
    async profile() {
      const now = base.now();
      if (cached && now - cached.at < PROFILE_TTL_MS) return { ...cached.profile, today: dateIn(now, cached.profile.zone) };
      const { data: account } = await base.client.account();
      const zone = account.timezone ?? base.configuredZone ?? "UTC";
      const zoneSource = account.timezone ? "business profile" : base.configuredZone ? "connector setting (WHITEFLOW_TIMEZONE)" : "default (UTC): set WHITEFLOW_TIMEZONE";
      const merchant = account.merchant.id ?? account.merchant.address ?? account.merchant.name;
      const scope = Journal.scope(base.client.origin.origin, account.environment, merchant);
      cached = { at: now, profile: { account, zone, zoneSource, today: dateIn(now, zone), scope } };
      return cached.profile;
    },
    async require(capability, what) {
      const profile = await ctx.profile();
      if (profile.account.capabilities[capability]) return profile;
      throw new ToolRefusal(`${what} ${base.mode === "testnet" ? "isn't available on the WhiteFlow testnet backend yet (planned for the W3 invoices release)." : "isn't available on this backend."}`, {
        supported_on_this_backend: Object.entries(profile.account.capabilities).filter(([, on]) => on).map(([name]) => name),
        next_action: "For a payment now, use create_payment_link. To try the full invoice flow, run the connector in sandbox mode (WHITEFLOW_MODE=sandbox).",
      });
    },
    trustedUrl(value, what) {
      let url: URL;
      try {
        url = new URL(value, base.client.origin);
      } catch {
        throw new Mismatch(`${what} isn't a URL`);
      }
      const allowed = [base.client.origin.origin, ...base.trustedOrigins];
      const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
      if (!secure || url.username || url.password || !allowed.includes(url.origin)) throw new Mismatch(`${what} ${url.origin} is not on a trusted WhiteFlow origin`);
      return url.toString();
    },
    async write(op, payload, opts, send, verify) {
      const { scope } = await ctx.profile();
      let claim;
      try {
        claim = base.journal.claim(scope, op, payload, { callerKey: opts.key, createAnother: opts.createAnother });
      } catch (error) {
        if (!(error instanceof JournalRefusal)) throw error;
        const e = error.entry;
        throw new ToolRefusal(error.message, { outcome: e?.outcome ?? "blocked", idempotency_key: e?.key ?? null, since: e ? iso(e.at) : null, note: e?.note ?? null, next_action: NEXT_RECONCILE });
      }
      const until = iso(claim.since + SERVER_RETENTION_MS);
      try {
        const result = await send(claim.key);
        try {
          verify?.(result.data);
        } catch (error) {
          if (!(error instanceof Mismatch)) throw error;
          base.journal.settle(scope, claim.key, "needs_reconciliation", error.message);
          throw new ToolRefusal(`WhiteFlow's reply doesn't match what was asked: ${error.message}. Don't share or use this record; the operation is marked for reconciliation.`, {
            outcome: "needs_reconciliation",
            idempotency_key: claim.key,
            next_action: "Tell the merchant. Check the record in the WhiteFlow dashboard before doing anything else with it.",
          });
        }
        base.journal.settle(scope, claim.key, "done");
        return { ...result, key: claim.key, source: claim.source };
      } catch (error) {
        if (error instanceof ToolRefusal) throw error;
        if (error instanceof ApiError && error.ambiguous) {
          // outcome unknown: the journal keeps it pending, so the next same call resumes it with this key
          throw new ToolRefusal(
            `${error.message} Calling this tool again with the same input resumes this operation (idempotency key ${claim.key}) until ${until}, while WhiteFlow can still replay it, so it won't create a duplicate. After that, check the record before creating another.`,
            { outcome: "unknown", idempotency_key: claim.key, resumable_until: until },
          );
        }
        base.journal.settle(scope, claim.key, "refused");
        throw error;
      }
    },
  };
  return ctx;
}

/** "Friday 2026-11-13 (Asia/Kolkata)", and how it relates to today. */
export function dueLabel(dueDate: string, profile: Profile): string {
  const label = labelled(dueDate, profile.zone);
  if (dueDate === profile.today) return `${label}, today`;
  return label;
}

export const replayNote = (written: { replayed: boolean; source: Written<unknown>["source"] }, thing: string) =>
  written.replayed
    ? `This is the ${thing} an earlier identical request already created (${written.source === "resumed" ? "the connector resumed that unresolved attempt" : written.source === "replay" ? "the same request was repeated within 15 minutes" : "same idempotency_key"}); nothing new was made. To create a separate, identical one on purpose, call again with create_another: true.`
    : undefined;
