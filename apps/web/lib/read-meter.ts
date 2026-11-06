// Browser-only: counts this page's chain reads for the privacy meter (FR-PRIV-3). "private" went through Anon-RPC (Nym),
// "plain" left the browser in the clear through the wallet's own RPC, "setup" is the Nym bootstrap lookup on Ethereum
// mainnet (a FR-PRIV-4 exclusion, the same for everyone), kept apart from the share. One snapshot, replaced on every
// change, for useSyncExternalStore.
export type ReadKind = "private" | "plain" | "setup";
/** The Anon-RPC boot: idle until a merchant page starts it after first paint (NFR-13). */
export type PrivateStatus = "idle" | "connecting" | "ready" | "failed";
export type ReadMeter = Readonly<Record<ReadKind, number> & { status: PrivateStatus }>;

const START: ReadMeter = { private: 0, plain: 0, setup: 0, status: "idle" };
let meter = START;
const listeners = new Set<() => void>();

function update(next: ReadMeter): void {
  meter = next;
  for (const listener of listeners) listener();
}

export const countRead = (kind: ReadKind) => update({ ...meter, [kind]: meter[kind] + 1 });
export const setPrivateStatus = (status: PrivateStatus) => update({ ...meter, status });

export function subscribeMeter(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const readMeter = (): ReadMeter => meter;
export const serverMeter = (): ReadMeter => START;

/** What follows "Private reads" on the chip: "7 of 9", or the connection before the first read. */
export function meterValue(m: ReadMeter): string {
  const total = m.private + m.plain;
  if (total > 0) return `${m.private} of ${total}`;
  return m.status === "ready" ? "on" : m.status === "failed" ? "off" : "connecting…";
}
