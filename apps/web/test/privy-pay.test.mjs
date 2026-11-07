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

const { privyAttempt, endPrivySession, clearPrivyStorage, OPENED_FAILED } = await import("../lib/privy-session.ts");
const { WALLET_CANCELLED } = await import("../lib/outcome.ts");
const walletPay = source("components/WalletPay.tsx");
const PRIVACY_URL = "https://whiteflow-app.vercel.app/docs";

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
  // security 046 M2: Privy's modal footer links our privacy notes
  assert.equal(config.legal.privacyPolicyUrl, PRIVACY_URL);
});

test("WalletOption: one line under the Privy button says who sees what (security 046 M2)", () => {
  const notice = walletPay.slice(walletPay.indexOf('id="privy-notice"'), walletPay.indexOf("</p>", walletPay.indexOf('id="privy-notice"')));
  assert.match(notice, /Opens Privy and WalletConnect\. They see your IP address, and with email, your email and wallet address\./);
  assert.match(walletPay, /aria-describedby="wallet-hint privy-notice"/, "the Privy button points at the notice");
});

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
  assert.match(privyPay, /const end = \(\) => endPrivySession\(state\.wallets, state\.logout, browserStorage\(\)\);/, "ends the Privy session");
  assert.match(privyPay, /const close = async \(\) => \{\s*try \{\s*await end\(\);/, "close() awaits it");
  assert.match(privyPay, /lingering\?\.\(\); \/\/ never two Privy trees/, "a new attempt ends a cancelled one's tree first");
  assert.match(privyPay, /root\.unmount\(\)/, "and removes the Privy tree");
});

// Security review 046 M1: the next checkout never silently reuses an earlier Privy session.
/** A wallet as Privy lists it, counting its disconnects. */
const wallet = (walletClientType) => {
  const w = { walletClientType, disconnects: 0, disconnect: () => void w.disconnects++ };
  return w;
};
const attempt = () => {
  const outcomes = [];
  return { outcomes, a: privyAttempt((o) => outcomes.push(o)) };
};

test("M1: already signed in before this attempt → signed out first, then the modal opens (once)", async () => {
  const { a, outcomes } = attempt();
  const order = [];
  const logout = async () => void order.push("logout");
  await a.ready(true, logout, () => order.push("open"));
  await a.ready(true, logout, () => order.push("open"));
  assert.deepEqual(order, ["logout", "open"]);
  assert.deepEqual(outcomes, []);

  const fresh = attempt();
  const freshOrder = [];
  await fresh.a.ready(false, async () => void freshOrder.push("logout"), () => freshOrder.push("open"));
  assert.deepEqual(freshOrder, ["open"], "not signed in: nothing to sign out");

  const failing = attempt();
  await failing.a.ready(true, () => Promise.reject(new Error("offline")), () => assert.fail("must not open on a session it couldn't end"));
  assert.deepEqual(failing.outcomes, [{ message: OPENED_FAILED }]);
});

test("M1: Privy's email wallet counts only after this attempt's own success callback", () => {
  const { a, outcomes } = attempt();
  const leftover = wallet("privy");
  a.wallets([leftover]); // listed before this attempt's own sign-in: ignored
  assert.deepEqual(outcomes, []);
  a.succeeded(); // the email sign-in completed; the wallet comes a moment later
  a.wallets([leftover]);
  assert.deepEqual(outcomes, [{ wallet: leftover }]);

  const external = attempt();
  const metamask = wallet("metamask");
  external.a.wallets([metamask]);
  assert.deepEqual(external.outcomes, [], "a listed wallet alone settles nothing");
  external.a.succeeded(metamask);
  external.a.succeeded(wallet("rainbow"));
  assert.deepEqual(external.outcomes, [{ wallet: metamask }], "the first outcome only");
});

test("M1: a cancel disconnects every connected wallet, and one that connects after it (late WalletConnect)", () => {
  const { a, outcomes } = attempt();
  const injected = wallet("metamask");
  a.cancel([injected]);
  assert.deepEqual(outcomes, [{ message: WALLET_CANCELLED }]);
  assert.equal(injected.disconnects, 1);
  const late = wallet("wallet_connect");
  a.wallets([injected, late]); // the phone wallet approved after the 1.5 s grace
  assert.equal(late.disconnects, 1);
  const lateSuccess = wallet("rainbow");
  a.succeeded(lateSuccess);
  assert.equal(lateSuccess.disconnects, 1);
  assert.deepEqual(outcomes, [{ message: WALLET_CANCELLED }], "still a cancel: no late wallet is used");

  const paid = attempt();
  const used = wallet("metamask");
  paid.a.succeeded(used);
  paid.a.cancel([used]); // the modal closing after a success is not a cancel
  assert.equal(used.disconnects, 0);
  assert.deepEqual(paid.outcomes, [{ wallet: used }]);
});

/** localStorage, roughly, recording when each key goes. */
function fakeStorage(entries) {
  const map = new Map(entries);
  const log = [];
  return {
    log,
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => (log.push(`remove ${k}`), map.delete(k)),
  };
}

test("M1: close() removes Privy's tokens and privy:caid synchronously, before awaiting the sign-out", async () => {
  const storage = fakeStorage([
    ["privy:token", "t"],
    ["privy:refresh_token", "r"],
    ["privy:caid", "c"],
    [`privy:${APP_ID}:recent-login-method`, "email"],
    ["mcplus.guestKey", "keep"],
    ["theme", "dark"],
  ]);
  const w = wallet("wallet_connect");
  let release;
  const logout = () => (storage.log.push("logout started"), new Promise((resolve) => (release = resolve)));
  const closing = endPrivySession([w], logout, storage);
  // before the sign-out settles, the local copies are already gone
  assert.deepEqual([...storage.map.keys()], ["mcplus.guestKey", "theme"]);
  assert.equal(w.disconnects, 1);
  assert.equal(storage.log[0], "logout started");
  release();
  await closing;

  // a sign-out that fails still leaves nothing to reuse
  const again = fakeStorage([["privy:token", "t"]]);
  await endPrivySession([], () => Promise.reject(new Error("offline")), again);
  assert.equal(again.map.size, 0);
  clearPrivyStorage(again); // and an empty store is fine
});
