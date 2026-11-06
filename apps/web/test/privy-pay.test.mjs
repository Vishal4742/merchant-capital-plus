// Batch 046 (FR-PAY-16, FR-PAY-7, FR-PRIV-1, AT-17): "Pay with your wallet" through Privy, for a customer whose browser
// has no wallet (a phone): any wallet app over WalletConnect (QR on desktop, deep link on a phone) or an email wallet.
// Pins the Privy config (Whitechain Testnet 1874 only, our RPC, no Coinbase), the rule that the option is hidden
// without a public app ID, and the sheets closing the Privy session after every attempt. The signing path itself (one
// message, never a transaction) is in payer-wallet.test.mjs. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { privyAppId, walletConnectProjectId, privyConfig, whitechainTestnet } = await import("../lib/privy-config.ts");
const { WHITECHAIN_TESTNET } = await import("../lib/onboarding.ts");
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const APP_ID = "clabcdefghij0123456789xyz"; // the shape of a Privy app ID (not a real one)
const WC_ID = "0123456789abcdef0123456789abcdef"; // the shape of a WalletConnect project ID (not a real one)

test("the Privy app ID: unset, blank or malformed → null (the option is hidden); a well-formed one is kept, trimmed", () => {
  for (const raw of [undefined, "", "   ", "not an id!", "x".repeat(80), "<script>"]) assert.equal(privyAppId(raw), null, String(raw));
  assert.equal(privyAppId(APP_ID), APP_ID);
  assert.equal(privyAppId(` ${APP_ID}\n`), APP_ID);
});

test("the WalletConnect project ID is optional: 32 hex characters or null", () => {
  for (const raw of [undefined, "", "abc", `${WC_ID}0`, "zz".repeat(16)]) assert.equal(walletConnectProjectId(raw), null, String(raw));
  assert.equal(walletConnectProjectId(WC_ID), WC_ID);
});

test("the chain: Whitechain Testnet 1874 with our RPC, the only supported chain and the default", () => {
  assert.equal(whitechainTestnet.id, 1874);
  assert.equal(whitechainTestnet.name, WHITECHAIN_TESTNET.chainName);
  assert.deepEqual(whitechainTestnet.rpcUrls.default.http, [WHITECHAIN_TESTNET.rpcUrls[0]]);
  assert.equal(whitechainTestnet.nativeCurrency.symbol, "WBT");
  const config = privyConfig(null);
  assert.deepEqual(config.supportedChains.map((c) => c.id), [1874]);
  assert.equal(config.defaultChain.id, 1874);
});

test("the modal: wallets and email only, no Coinbase (its relay isn't in the pay pages' CSP), Ethereum wallets only", () => {
  const config = privyConfig(null);
  assert.deepEqual(config.loginMethods, ["wallet", "email"]);
  assert.equal(config.appearance.walletChainType, "ethereum-only");
  assert.ok(config.appearance.walletList.includes("wallet_connect"), "phone wallets over WalletConnect");
  assert.ok(!config.appearance.walletList.some((w) => /coinbase|base_account/.test(w)));
  // an email customer gets a wallet to pay from; a wallet customer is only connected (no sign-in message)
  assert.equal(config.embeddedWallets.ethereum.createOnLogin, "users-without-wallets");
  assert.equal(config.walletConnectCloudProjectId, undefined);
  assert.equal(privyConfig(WC_ID).walletConnectCloudProjectId, WC_ID);
});

const walletPay = source("components/WalletPay.tsx");

test("WalletOption: the Privy button renders only when the public app ID is set (hidden, not disabled, without it)", () => {
  assert.match(walletPay, /const privy = privyAppId\(\);/);
  assert.match(walletPay, /\{privy && \(/, "the Privy button sits behind the app ID check");
  // Privy itself is loaded on the press, never on the sheet's first load (NFR-12)
  assert.match(walletPay, /await import\("@\/components\/PrivyPay"\)/);
  assert.doesNotMatch(walletPay, /^import [^\n]*@privy-io/m);
  for (const file of ["components/Checkout.tsx", "components/InvoicePay.tsx"]) assert.doesNotMatch(source(file), /@privy-io|PrivyPay/, file);
});

test("both sheets close the Privy session after every attempt (paid, cancelled or failed)", () => {
  for (const file of ["components/Checkout.tsx", "components/InvoicePay.tsx"]) {
    assert.match(source(file), /inFlight\.current = submit\(via\)\.finally\(\(\) => \{\s*endWalletSession\(\);/, file);
  }
  const privyPay = source("components/PrivyPay.tsx");
  assert.match(privyPay, /await logout\(\)/, "close() logs the customer out of Privy");
  assert.match(privyPay, /root\.unmount\(\)/, "and removes the Privy tree");
});
