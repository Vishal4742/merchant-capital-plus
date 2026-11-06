// Batch 032 (FR-PAY-16, AT-17): "Pay with your wallet". An EIP-1193 fake stands in for MetaMask: it answers the account,
// chain and network requests and signs eth_signTypedData_v4 with a throwaway key, recording every request, so the test
// shows the wallet is asked for one message and never a transaction, and that the pay route takes its approval exactly
// as it takes the guest's. Real SQL on PGlite; the chain and the relayer are faked. Run from apps/web: npm test
import { test, before, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getTypesForEIP712Domain, keccak256, serializeTypedData, toHex, verifyTypedData } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { setupDb, resetDb, MERCHANT } from "./gw-helpers.mjs";

process.env.MERCHANT_ADDRESS = MERCHANT;
process.env.MERCHANT_NAME = "Bandra Beans";
const MERCHANT_PAY = "0x2222222222222222222222222222222222222222";

let chainPaid = false;
mock.module("../lib/onchain.ts", {
  namedExports: {
    saleSettled: async () => (chainPaid ? "1" : null),
    readUsdtBalance: async () => 1_000_000_000n,
    readPayment: async () => ({ merchant: MERCHANT, gross: 1n, payer: MERCHANT, refunded: 0n }),
  },
});

const relayCalls = [];
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith("http://relayer.test")) return Response.json({});
  relayCalls.push(JSON.parse(init.body).args);
  chainPaid = true;
  return Response.json({ txHash: `0x${"ab".repeat(32)}`, blockNumber: "9" });
};

const store = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
});
// a throwaway guest key derived at runtime, so no key literal sits in a file
store.set("mcplus.guestKey", keccak256(toHex("mcplus payer-wallet test guest")));

const { connectPayer } = await import("../lib/payer-wallet.ts");
const { signSale, signInvoice, guestAddress } = await import("../lib/sign-sale.ts");
const { saleAuthorization, invoiceAuthorization } = await import("../lib/pay.ts");
const { WHITECHAIN_TESTNET } = await import("../lib/onboarding.ts");
const { POST: pay } = await import("../app/api/v1/sessions/[id]/pay/route.ts");
const { createSession, getSession } = await import("../lib/sessions.ts");

const CHAIN = 1874;
const rpcError = (code, message = "wallet error") => Object.assign(new Error(message), { code });

/** MetaMask, roughly: one account, a current chain, chain 1874 known or not, and per-method refusals. Like MetaMask it
 *  refuses typed data whose domain chain isn't the current one. */
function fakeWallet({ chainId = CHAIN, knows1874 = true, switches = true, refuse = {} } = {}) {
  const account = privateKeyToAccount(generatePrivateKey());
  const calls = [];
  let chain = chainId;
  let known = knows1874;
  const typed = [];
  const provider = {
    account,
    calls,
    typed,
    async request({ method, params }) {
      calls.push(method);
      if (refuse[method]) throw refuse[method];
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account.address.toLowerCase()]; // MetaMask answers lowercase
        case "eth_chainId":
          return toHex(chain);
        case "wallet_switchEthereumChain":
          if (!known) throw rpcError(4902, "Unrecognized chain ID");
          if (switches) chain = Number(params[0].chainId);
          return null;
        case "wallet_addEthereumChain":
          known = true;
          return null;
        case "eth_signTypedData_v4": {
          const [from, json] = params;
          assert.equal(from.toLowerCase(), account.address.toLowerCase());
          typed.push(json);
          const data = JSON.parse(json);
          if (data.domain.chainId !== chain) throw rpcError(-32602, "Provided chainId must match the active chainId");
          const { EIP712Domain, ...types } = data.types;
          assert.ok(EIP712Domain);
          const m = data.message;
          const message = { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) };
          return account.signTypedData({ domain: data.domain, types, primaryType: data.primaryType, message });
        }
        default:
          throw rpcError(4200, `unsupported ${method}`);
      }
    },
    on() {},
    removeListener() {},
  };
  return provider;
}

const TX_METHODS = ["eth_sendTransaction", "eth_sendRawTransaction", "eth_signTransaction", "wallet_sendCalls"];

before(setupDb);
beforeEach(async () => {
  await resetDb();
  chainPaid = false;
  relayCalls.length = 0;
  process.env.MERCHANT_PAY_ADDRESS = MERCHANT_PAY;
  process.env.RELAYER_URL = "http://relayer.test";
});

async function newCheckout(amount = 5_000_000n) {
  const session = await createSession({ merchant: MERCHANT, merchantName: "Bandra Beans", amount, reference: "", items: [] });
  const sale = { merchantPay: MERCHANT_PAY, merchant: session.merchant, orderRef: session.orderRef, amount: amount.toString() };
  return { session, sale };
}
const callPay = async (id, body) => {
  const res = await pay(new Request(`http://shop.test/api/v1/sessions/${id}/pay`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
  return { status: res.status, data: await res.json() };
};

test("AT-17: a wallet on chain 1874 is asked for one message, no transaction, and the pay route relays its approval", async () => {
  const wallet = fakeWallet();
  const { session, sale } = await newCheckout();
  const payer = await connectPayer(wallet);
  assert.equal(payer.address.toLowerCase(), wallet.account.address.toLowerCase());
  const body = await signSale(sale, session.expiresAt, payer);
  assert.equal(body.from.toLowerCase(), wallet.account.address.toLowerCase());

  const { status, data } = await callPay(session.id, { ...body, amount: sale.amount });
  assert.equal(status, 200, JSON.stringify(data));
  assert.equal(data.receiptId, session.id);
  assert.equal(relayCalls.length, 1);
  assert.equal(relayCalls[0].from.toLowerCase(), wallet.account.address.toLowerCase());
  assert.equal(relayCalls[0].amount, sale.amount);
  assert.equal((await getSession(session.id)).payment.from.toLowerCase(), wallet.account.address.toLowerCase());

  assert.equal(wallet.calls.filter((m) => m === "eth_signTypedData_v4").length, 1);
  assert.deepEqual(wallet.calls.filter((m) => TX_METHODS.includes(m)), []);
  assert.ok(!wallet.calls.includes("wallet_switchEthereumChain"), "already on 1874: no network prompt");
});

test("the wallet signs exactly the typed data the guest signs for the same checkout, salt and time", async (t) => {
  t.mock.method(Date, "now", () => 1_900_000_000_000);
  t.mock.method(globalThis.crypto, "getRandomValues", (bytes) => bytes.fill(7));
  const { sale } = await newCheckout();
  const expiresAt = 1_900_000_000_000 + 30 * 60_000;

  const guestBody = await signSale(sale, expiresAt); // the default: this browser's guest key
  assert.equal(guestBody.from, guestAddress());
  const wallet = fakeWallet();
  const walletBody = await signSale(sale, expiresAt, await connectPayer(wallet));
  assert.equal(walletBody.salt, guestBody.salt);
  assert.equal(walletBody.validBefore, guestBody.validBefore);

  const terms = { ...sale, amount: BigInt(sale.amount) };
  const guestTyped = saleAuthorization(terms, guestBody.from, guestBody.salt, BigInt(guestBody.validBefore));
  const walletTyped = saleAuthorization(terms, wallet.account.address, walletBody.salt, BigInt(walletBody.validBefore));
  // what the wallet was shown is the guest's typed data with only `from` changed
  assert.deepEqual(JSON.parse(wallet.typed[0]), JSON.parse(serializeTypedData({ ...walletTyped, types: { EIP712Domain: getTypesForEIP712Domain({ domain: walletTyped.domain }), ...walletTyped.types } })));
  assert.deepEqual({ ...walletTyped.message, from: null }, { ...guestTyped.message, from: null });
  assert.deepEqual(walletTyped.domain, guestTyped.domain);
  // and both pass the server's check (app/api/v1/sessions/[id]/pay/route.ts)
  assert.ok(await verifyTypedData({ ...guestTyped, address: guestBody.from, signature: guestBody.signature }));
  assert.ok(await verifyTypedData({ ...walletTyped, address: walletBody.from, signature: walletBody.signature }));
});

test("an invoice: the wallet signs invoiceAuthorization (owed + fee), the same as the guest", async () => {
  const wallet = fakeWallet();
  const terms = { merchantPay: MERCHANT_PAY, invoiceId: "7", amount: "25000000", fee: "100000" };
  const body = await signInvoice(terms, await connectPayer(wallet));
  const typed = invoiceAuthorization({ merchantPay: MERCHANT_PAY, invoiceId: 7n, amount: 25_000_000n, fee: 100_000n }, body.from, body.salt, BigInt(body.validBefore));
  assert.equal(typed.message.value, 25_100_000n);
  assert.ok(await verifyTypedData({ ...typed, address: body.from, signature: body.signature }));
  assert.deepEqual(wallet.calls.filter((m) => TX_METHODS.includes(m)), []);
});

test("a wallet on another network is switched to chain 1874 first", async () => {
  const wallet = fakeWallet({ chainId: 1 });
  await connectPayer(wallet);
  assert.ok(wallet.calls.includes("wallet_switchEthereumChain"));
  assert.ok(!wallet.calls.includes("wallet_addEthereumChain"));
});

test("a wallet that doesn't know chain 1874 is asked to add Whitechain Testnet (the onboarding's parameters)", async () => {
  const wallet = fakeWallet({ chainId: 1, knows1874: false });
  const seen = [];
  const request = wallet.request.bind(wallet);
  wallet.request = async (args) => (args.method === "wallet_addEthereumChain" && seen.push(args.params[0]), request(args));
  const payer = await connectPayer(wallet);
  assert.deepEqual(seen, [WHITECHAIN_TESTNET]);
  assert.equal(seen[0].chainId, "0x752");
  // then the approval works on 1874
  const { session, sale } = await newCheckout();
  await signSale(sale, session.expiresAt, payer);
});

test("a wallet that stays on another network is refused before any approval prompt", async () => {
  const wallet = fakeWallet({ chainId: 1, switches: false });
  await assert.rejects(connectPayer(wallet), /Whitechain Testnet/);
  assert.ok(!wallet.calls.includes("eth_signTypedData_v4"));
});

test("cancel, a request already open, a refused network, and no wallet: one plain sentence each, nothing charged", async () => {
  await assert.rejects(connectPayer(fakeWallet({ refuse: { eth_requestAccounts: rpcError(4001, "User rejected the request.") } })), /^Error: You cancelled in your wallet\. Nothing was charged\.$/);
  await assert.rejects(connectPayer(fakeWallet({ refuse: { eth_requestAccounts: rpcError(-32002, "Already processing") } })), /already has a request open/);
  await assert.rejects(connectPayer(fakeWallet({ chainId: 1, refuse: { wallet_switchEthereumChain: rpcError(4001) } })), /You cancelled in your wallet/);
  await assert.rejects(connectPayer(undefined), /Install MetaMask/);

  const { session, sale } = await newCheckout();
  const refusing = fakeWallet({ refuse: { eth_signTypedData_v4: rpcError(4001, "User denied message signature.") } });
  await assert.rejects(signSale(sale, session.expiresAt, await connectPayer(refusing)), /You cancelled in your wallet\. Nothing was charged\./);
  assert.equal(relayCalls.length, 0);
});

test("a wallet that shares no account says so", async () => {
  const wallet = fakeWallet();
  const request = wallet.request.bind(wallet);
  wallet.request = async (args) => (args.method === "eth_requestAccounts" ? [] : request(args));
  await assert.rejects(connectPayer(wallet), /didn't share an account/);
});
