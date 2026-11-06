// What every tool shares (batch 052): the client, the key journal, the reply path, the business profile (cached a
// minute) with its time zone, the capability gate, and the one write path (journaled Idempotency-Key, FR-MCP-15).
import { ApiError, type WhiteflowClient } from "../client.ts";
import type { Account } from "../contract.ts";
import { dateIn, labelled } from "../dates.ts";
import type { Journal } from "../journal.ts";
import type { Mode } from "../config.ts";
import { ToolRefusal, type Logger, type Reply } from "../safety.ts";

const PROFILE_TTL_MS = 60_000;
export const EXPLORER_TX = "https://explorer.testnet.whitechain.io/tx/";
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9_.:-]{8,100}$/;

export type Capability = keyof Account["capabilities"];

export interface Profile {
  account: Account;
  zone: string;
  zoneSource: "business profile" | "connector setting (WHITEFLOW_TIMEZONE)" | "default (UTC): set WHITEFLOW_TIMEZONE";
  today: string;
}

export interface Ctx {
  mode: Mode;
  client: WhiteflowClient;
  journal: Journal;
  reply: Reply;
  log: Logger;
  now: () => number;
  configuredZone: string | null;
  profile(): Promise<Profile>;
  require(capability: Capability, what: string): Promise<Profile>;
  write<T>(op: string, payload: unknown, callerKey: string | undefined, send: (key: string) => Promise<{ data: T; replayed: boolean }>): Promise<{ data: T; replayed: boolean; key: string; recovered: boolean }>;
}

export function makeContext(base: Omit<Ctx, "profile" | "require" | "write">): Ctx {
  let cached: { at: number; profile: Profile } | null = null;
  const ctx: Ctx = {
    ...base,
    async profile() {
      const now = base.now();
      if (cached && now - cached.at < PROFILE_TTL_MS) return { ...cached.profile, today: dateIn(now, cached.profile.zone) };
      const { data: account } = await base.client.account();
      const zone = account.timezone ?? base.configuredZone ?? "UTC";
      const zoneSource = account.timezone ? "business profile" : base.configuredZone ? "connector setting (WHITEFLOW_TIMEZONE)" : "default (UTC): set WHITEFLOW_TIMEZONE";
      cached = { at: now, profile: { account, zone, zoneSource, today: dateIn(now, zone) } };
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
    async write(op, payload, callerKey, send) {
      const claim = base.journal.claim(op, payload, callerKey);
      try {
        const result = await send(claim.key);
        base.journal.settle(claim.key, "done");
        return { ...result, key: claim.key, recovered: claim.source === "recovered" };
      } catch (error) {
        if (error instanceof ApiError && error.ambiguous) {
          // outcome unknown: the journal keeps it pending, so the next same call reuses this key
          throw new ToolRefusal(`${error.message} It is safe to call this tool again with the same input: it reuses idempotency key ${claim.key}, so WhiteFlow returns the original record if it was created and never makes a duplicate.`, { idempotency_key: claim.key, outcome: "unknown" });
        }
        base.journal.settle(claim.key, "refused");
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

export const replayNote = (replayed: boolean, recovered: boolean, thing: string) =>
  replayed
    ? `This is the ${thing} an earlier identical request already created (${recovered ? "the connector reused that attempt's idempotency key" : "same idempotency_key"}); nothing new was made. To create a separate one on purpose, call again with a new idempotency_key.`
    : undefined;
