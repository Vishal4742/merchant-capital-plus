// The investor's "I disconnected" choice on the Capital pages (batch 063): while it is set, a page load doesn't reconnect
// the wallet silently; Connect clears it. A plain module so tests can drive it with a fake storage.
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const KEY = "mcplus.investorOff"; // an mcplus.* key: the Whiteflow rename sweep keeps these

/** Storage blocked or missing (private mode, a test) reads as "not off": the page behaves as before. */
export function investorOff(store: Store | undefined): boolean {
  try {
    return store?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setInvestorOff(store: Store | undefined, off: boolean): void {
  try {
    if (off) store?.setItem(KEY, "1");
    else store?.removeItem(KEY);
  } catch {
    // blocked storage: the choice holds for this page only
  }
}
