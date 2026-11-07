// The browser wallet (EIP-1193) that every wallet screen reads as window.ethereum. Batch 051: moved here from
// components/merchant/SignIn.tsx. Privy's types also declare `ethereum?: any` on Window; TypeScript reports that clash at
// whichever declaration it reads second. In a .tsx that broke `tsc` as soon as the read order changed (review 051
// C-H1); in a declaration file it is a declaration-file clash that skipLibCheck ignores in either order.
import type { EIP1193Provider } from "viem";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export {};
