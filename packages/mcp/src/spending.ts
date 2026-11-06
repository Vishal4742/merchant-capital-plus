// Adapted from Pixa (MIT) src/spending.ts: the per-call and per-day budget check, with a history for the report.
// Changes for Merchant Capital+ (FR-MCP-5): USDT units as bigint instead of parseFloat; the state is a JSON file, so a
// restart can't reset the day; an attempt is recorded before it is sent and counts against the day unless the gateway
// refused it; a corrupt file stops payments instead of starting a fresh budget; no cap can pass 100 USDT.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { explorer, usdt } from "./common.ts";

export const CEILING = 100_000_000n; // 100 USDT: no env setting raises a cap past this

export interface Limits {
  perPayment: bigint;
  perDay: bigint;
}

/** sending: written before the POST (a crash leaves it counted); unknown: no clear answer, it may still settle. */
export type SpendStatus = "sending" | "paid" | "unknown";

export interface SpendRecord {
  id: string;
  checkoutId: string;
  amount: string; // USDT units
  at: string; // ISO time the attempt started
  status: SpendStatus;
  txHash: string | null;
}

export type Outcome = { txHash: string | null } | "unknown" | "refused";

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ponytail: one process at a time per file (pay_checkout calls are queued in-process); two servers sharing the file
// could both pass the day check at the same moment. Add a lock file if two assistants ever share one payer key.
export class SpendingTracker {
  readonly limits: Limits;
  readonly #file: string;
  readonly #now: () => number;

  constructor(file: string, limits: Limits, now: () => number) {
    this.#file = file;
    this.limits = limits;
    this.#now = now;
  }

  /** Throws a plain reason when `amount` breaks a cap; otherwise records the attempt as sending. */
  begin(checkoutId: string, amount: bigint): SpendRecord {
    const records = this.#load();
    const { perPayment, perDay } = this.limits;
    if (amount > perPayment) throw new Error(`This checkout is ${usdt(amount)} USDT, over the per-payment limit of ${usdt(perPayment)} USDT. Not paid.`);
    const spent = this.#spentToday(records);
    if (spent + amount > perDay) {
      throw new Error(`Paying ${usdt(amount)} USDT would pass the daily limit of ${usdt(perDay)} USDT (spent today: ${usdt(spent)} USDT). Not paid.`);
    }
    const record: SpendRecord = { id: randomUUID(), checkoutId, amount: amount.toString(), at: new Date(this.#now()).toISOString(), status: "sending", txHash: null };
    this.#save([...records, record]);
    return record;
  }

  /** Paid or unknown keeps the attempt (it counts); refused removes it (nothing was charged). */
  settle(record: SpendRecord, outcome: Outcome): void {
    const others = this.#load().filter((r) => r.id !== record.id);
    if (outcome === "refused") return this.#save(others);
    const settled: SpendRecord = outcome === "unknown" ? { ...record, status: "unknown" } : { ...record, status: "paid", txHash: outcome.txHash };
    this.#save([...others, settled]);
  }

  report() {
    const records = this.#load();
    const spent = this.#spentToday(records);
    const left = this.limits.perDay > spent ? this.limits.perDay - spent : 0n;
    return {
      spentToday: usdt(spent),
      remainingToday: usdt(left),
      limits: { perPayment: usdt(this.limits.perPayment), perDay: usdt(this.limits.perDay) },
      currency: "USDT",
      dayResets: "00:00 UTC",
      payments: records.map((r) => ({ checkoutId: r.checkoutId, amount: usdt(BigInt(r.amount)), at: r.at, status: r.status, txHash: r.txHash, explorer: explorer(r.txHash) })),
    };
  }

  #spentToday(records: SpendRecord[]): bigint {
    const today = utcDay(this.#now());
    return records.filter((r) => utcDay(Date.parse(r.at)) === today).reduce((sum, r) => sum + BigInt(r.amount), 0n);
  }

  #load(): SpendRecord[] {
    if (!existsSync(this.#file)) return [];
    try {
      const { payments } = JSON.parse(readFileSync(this.#file, "utf8")) as { payments: SpendRecord[] };
      if (!Array.isArray(payments) || !payments.every((r) => /^\d+$/.test(r?.amount) && !Number.isNaN(Date.parse(r?.at)))) throw new Error("bad shape");
      return payments;
    } catch {
      throw new Error(`The spending file ${this.#file} can't be read, so no payment is made. Fix it, or move it aside to start a new budget.`);
    }
  }

  #save(payments: SpendRecord[]): void {
    mkdirSync(dirname(this.#file), { recursive: true, mode: 0o700 });
    const temp = `${this.#file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ payments }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.#file); // whole file or nothing: a crash mid-write never leaves half a budget
  }
}
