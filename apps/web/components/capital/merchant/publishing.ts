// Which offers may not be published again yet (UX 036 F5): one whose publish is in flight, or settled but not followed
// by a fresh read of the book. An Arkiv write can land after our request gives up, and the server finds only entities
// already written, so a second publish in that window would make a duplicate. Browser-wide module state; React reads
// it through useSyncExternalStore (subscribe + snapshot). Pure, so node:test covers it.

const IN_FLIGHT = -1;
let reads = 0; // bumps each time the page's offers come back from the server
let version = 0; // bumps on every change, for useSyncExternalStore
const settledAt = new Map<string, number>(); // claimId → `reads` when its publish settled, or IN_FLIGHT
const listeners = new Set<() => void>();

function changed(): void {
  version++;
  for (const listener of listeners) listener();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const snapshot = (): number => version;

export function startPublish(claimId: string): void {
  settledAt.set(claimId, IN_FLIGHT);
  changed();
}

export function settlePublish(claimId: string): void {
  settledAt.set(claimId, reads);
  changed();
}

/** The page has new server data: the book was read again. */
export function bookRead(): void {
  reads++;
  changed();
}

export function publishBlocked(claimId: string): boolean {
  const at = settledAt.get(claimId);
  return at !== undefined && (at === IN_FLIGHT || reads <= at);
}
