// Withdraw from Settlements (FR-GW-15): payments already settle into the merchant's own wallet in their own transaction
// (MerchantPay._settle), so a withdraw is just that wallet sending its USDT on: an ERC-20 transfer the merchant signs
// and pays the WBT gas for, as with refunds. Nothing goes through our server or the relayer. The checks are pure, so the
// form refuses a bad address or amount before the wallet is even asked.
import { BaseError, ChainMismatchError, InsufficientFundsError, SwitchChainError, getAddress, isAddress, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { whitechainSepolia } from "viem/chains";
import { estimateContractTotalFee } from "viem/op-stack";
import type { Checked } from "./gateway-forms.ts";
import { SENT_UNCONFIRMED, walletError, type MerchantWallet } from "./merchant-wallet.ts";
import { USDT, formatUsdt, parseUsdt } from "./usdt.ts";

// ponytail: copied from packages/shared/contracts.ts (apps/web can't import it yet, see lib/onchain.ts); test/withdraw pins them
export const MERCHANT_PAY: Address = "0xab817593253a0a37de723072827d88fe0ca54251";
export const CAPITAL_MARKET: Address = "0xecd63a369d23dfddc6bfac921e41a86760c20abe";
export const CLAIM_TOKEN: Address = "0xce9b171a5c485a41dced9d7f043733bddc26c388";
export const INVESTOR_REGISTRY: Address = "0x293430fae87ca79844c6e3a64e8044078c4d3e74";
/** Our contracts aren't wallets and none can send USDT back: USDT sent to them is stuck there (security 033 M3). */
const CONTRACTS = [
  ["MerchantPay", MERCHANT_PAY],
  ["CapitalMarket", CAPITAL_MARKET],
  ["ClaimToken", CLAIM_TOKEN],
  ["InvestorRegistry", INVESTOR_REGISTRY],
  ["USDT", USDT],
] as const;

export const NOT_ENOUGH_WBT = "Your wallet needs a little WBT to pay the network fee. Add some, then try again.";
export const WRONG_NETWORK = "Your wallet is on another network. Switch it to Whitechain Testnet (chain 1874), then try again.";
export const UNCONFIRMED = "It was sent, but it isn't confirmed yet. Open the transaction and check it before you send again.";
export const NOT_THROUGH = "That didn't go through, and nothing moved. Try again.";
const NOT_ENOUGH_USDT = "Your wallet doesn't have that much USDT now. Reload the page to see what's there.";
const REFUSED = "USDT refused this transfer, so nothing was sent.";

const erc20 = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);
const ok = <T>(value: T) => ({ ok: true, value }) as const;
const no = (error: string) => ({ ok: false, error }) as const;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Where the USDT goes: a real address (EIP-55 checked when it has capitals), never the zero address, this wallet itself
 *  or one of our contracts. Returns it checksummed, as the confirm step shows it. */
export function checkDestination(text: string, merchant: Address): Checked<Address> {
  const typed = text.trim();
  if (!typed) return no("Enter the address to send to.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(typed)) return no("That isn't a wallet address: it starts with 0x and has 40 letters and numbers after it.");
  if (!isAddress(typed, { strict: true })) return no("That address's capital letters don't match its checksum, so it may have a typo. Copy it again from where you got it.");
  const to = getAddress(typed);
  if (to === zeroAddress) return no("That's the zero address. Anything sent there is lost for good.");
  if (same(to, merchant)) return no("That's this wallet's own address. Enter the address the USDT should go to.");
  const contract = CONTRACTS.find(([, address]) => same(address, to));
  if (contract) return no(`That's our ${contract[0]} contract, not a wallet. USDT sent there can't be got back.`);
  return ok(to);
}

/** "1.50" → 1_500_000n (parseUsdt: digits only, at most 6 decimals, no floats), above 0 and at most the balance. */
export function checkAmount(text: string, balance: bigint): Checked<bigint> {
  let units: bigint;
  try {
    units = parseUsdt(text);
  } catch {
    return no("Enter an amount like 25.00, with at most 6 decimals.");
  }
  if (units === 0n) return no("Enter an amount above 0.");
  if (units > balance) return no(`That's more than the ${formatUsdt(balance)} USDT in your wallet.`);
  return ok(units);
}

const transfer = (w: MerchantWallet, to: Address, amount: bigint) => ({ address: USDT, abi: erc20, functionName: "transfer", args: [to, amount], account: w.account }) as const;

/** The network fee for this transfer in WBT wei, before signing: L2 gas × its price + the L1 data fee, as FR-GW-10 counts
 *  it. Too little WBT to cover it stops here. A dry run that would revert (not enough USDT) throws too. */
export async function quoteWithdraw(w: MerchantWallet, to: Address, amount: bigint, estimate = estimateContractTotalFee): Promise<bigint> {
  const [fee, wbt] = await Promise.all([estimate(w.reader, transfer(w, to, amount)), w.reader.getBalance({ address: w.account })]);
  if (wbt < fee) throw new Error(NOT_ENOUGH_WBT);
  return fee;
}

/** Simulate, send from the merchant's wallet, wait for the receipt (merchant-wallet's send(), for a USDT transfer).
 *  `onSent` gets the hash the moment the wallet returns it, so the page can link it during the receipt wait (041).
 *  A receipt that can't be read throws SENT_UNCONFIRMED with the hash, so the page links it instead of inviting a resend. */
export async function withdraw(w: MerchantWallet, to: Address, amount: bigint, onSent?: (hash: Hex) => void): Promise<Hex> {
  // the wallet may have moved networks since Review; the dry run would then read another chain's state
  if ((await w.wallet.getChainId()) !== whitechainSepolia.id) throw new Error(WRONG_NETWORK);
  const { request, result } = await w.reader.simulateContract(transfer(w, to, amount));
  if (result !== true) throw new Error(REFUSED); // a token that returns false instead of reverting (security 033 L2)
  const hash = await w.wallet.writeContract(request as Parameters<MerchantWallet["wallet"]["writeContract"]>[0]);
  onSent?.(hash);
  const receipt = await w.reader.waitForTransactionReceipt({ hash }).catch(() => {
    throw Object.assign(new Error(SENT_UNCONFIRMED), { hash });
  });
  if (receipt.status !== "success") throw new Error(NOT_THROUGH);
  return hash;
}

/** After an unconfirmed send: "sent" once its receipt reads success, "failed" if it reverted, "pending" while there is
 *  no receipt yet. Until then the page offers no new send (security 033 M2). */
export async function sendStatus(w: MerchantWallet, hash: Hex): Promise<"sent" | "failed" | "pending"> {
  try {
    return (await w.reader.getTransactionReceipt({ hash })).status === "success" ? "sent" : "failed";
  } catch {
    return "pending"; // not mined yet, or the receipt read failed: either way it may still land
  }
}

/** Any error from the calls above as one plain sentence; the rest (cancelled, wrong account) as walletError says it. */
export function withdrawError(error: unknown): string {
  if (error instanceof Error && error.message === SENT_UNCONFIRMED) return UNCONFIRMED;
  if (error instanceof BaseError) {
    if (error.walk((e) => e instanceof InsufficientFundsError)) return NOT_ENOUGH_WBT;
    if (error.walk((e) => e instanceof ChainMismatchError || e instanceof SwitchChainError)) return WRONG_NETWORK;
    if (/exceeds balance/.test(error.message)) return NOT_ENOUGH_USDT;
  }
  return walletError(error);
}
