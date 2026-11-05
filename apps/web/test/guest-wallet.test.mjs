// Tester checks for lib/guest-wallet.ts (batch 001, DEP-3). No new dependency: Node's own test runner.
// Run from apps/web: node --experimental-test-module-mocks --test test/
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as viem from "viem";
import { privateKeyToAccount } from "viem/accounts";

// USDT on chain 1874: DOMAIN_SEPARATOR() read on-chain 2026-11-05 (eth_call 0x3644e515 via rpc.ankr.com).
const USDT_DOMAIN_SEPARATOR = "0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25";
const STORAGE_KEY = "mcplus.guestKey";
// Throwaway key derived at runtime, so no key literal sits in a file (and secret scanners stay quiet).
const TEST_KEY = viem.keccak256(viem.toHex("mcplus tester throwaway key"));

// Spy on verifyTypedData so the test sees the exact typed data and signature the proof uses.
const verifyCalls = [];
mock.module("viem", {
  exports: {
    ...viem,
    verifyTypedData: async (args) => {
      verifyCalls.push(args);
      return viem.verifyTypedData(args);
    },
  },
});
const { getGuestAccount, proveTypedDataSigning } = await import("../lib/guest-wallet.ts");

let store;
beforeEach(() => {
  store = new Map();
  verifyCalls.length = 0;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
    },
  });
});

test("creates one key on first use and returns the same account afterwards", () => {
  const first = getGuestAccount();
  const saved = store.get(STORAGE_KEY);
  assert.match(saved, /^0x[0-9a-f]{64}$/);
  const second = getGuestAccount();
  assert.equal(second.address, first.address);
  assert.equal(store.get(STORAGE_KEY), saved);
});

test("uses an existing saved key and never replaces it", () => {
  store.set(STORAGE_KEY, TEST_KEY);
  assert.equal(getGuestAccount().address, privateKeyToAccount(TEST_KEY).address);
  assert.equal(store.get(STORAGE_KEY), TEST_KEY);
});

test("throws on an unreadable saved value and leaves it untouched", () => {
  for (const bad of ["not-a-key", "0x1234", `${TEST_KEY}00`, TEST_KEY.slice(2)]) {
    store.set(STORAGE_KEY, bad);
    assert.throws(() => getGuestAccount(), /unreadable/);
    assert.equal(store.get(STORAGE_KEY), bad);
  }
});

test("signs the USDT ReceiveWithAuthorization shape for the real 1874 USDT domain, and it verifies", async () => {
  store.set(STORAGE_KEY, TEST_KEY);
  const signer = privateKeyToAccount(TEST_KEY).address;
  const result = await proveTypedDataSigning();
  assert.deepEqual(result, { address: signer, valid: true });

  assert.equal(verifyCalls.length, 1);
  const { domain, primaryType, message, signature, address } = verifyCalls[0];
  // The domain hashes to the separator the deployed USDT contract reports.
  assert.equal(viem.hashDomain({ domain, types: { EIP712Domain: viem.getTypesForEIP712Domain({ domain }) } }), USDT_DOMAIN_SEPARATOR);
  assert.deepEqual(domain, { name: "Tether USD", version: "1", chainId: 1874, verifyingContract: "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7" });
  assert.equal(primaryType, "ReceiveWithAuthorization");
  // The proof message cannot move funds.
  assert.equal(message.value, 0n);
  assert.equal(message.from, signer);
  assert.equal(message.to, signer);
  assert.equal(message.validBefore, 0n);
  assert.equal(address, signer);
  // Independent recovery, not only viem's verify.
  const typedData = verifyCalls[0];
  assert.equal(await viem.recoverTypedDataAddress({ ...typedData, signature }), signer);
});

// RECEIVE_WITH_AUTHORIZATION_TYPEHASH() on the same USDT, read on-chain 2026-11-05 (eth_call 0x7f2eecc3 via rpc.ankr.com).
const RECEIVE_TYPEHASH = "0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8";

test("the signed digest is the one the deployed USDT contract computes from its own type hash", async () => {
  store.set(STORAGE_KEY, TEST_KEY);
  await proveTypedDataSigning();
  const { address, signature, ...typedData } = verifyCalls[0];
  const { from, to, value, validAfter, validBefore, nonce } = typedData.message;
  const structHash = viem.keccak256(
    viem.encodeAbiParameters(
      viem.parseAbiParameters("bytes32, address, address, uint256, uint256, uint256, bytes32"),
      [RECEIVE_TYPEHASH, from, to, value, validAfter, validBefore, nonce],
    ),
  );
  const contractDigest = viem.keccak256(viem.concat(["0x1901", USDT_DOMAIN_SEPARATOR, structHash]));
  // A renamed or reordered field changes hashTypedData but not the on-chain constants, so this fails.
  assert.equal(viem.hashTypedData(typedData), contractDigest);
  assert.equal(await viem.recoverAddress({ hash: contractDigest, signature }), address);
});

test("a signature from a different key does not verify for the guest address", async () => {
  store.set(STORAGE_KEY, TEST_KEY);
  await proveTypedDataSigning();
  const { address, signature, ...typedData } = verifyCalls[0];
  const other = privateKeyToAccount(viem.keccak256("0x01"));
  const forged = await other.signTypedData(typedData);
  assert.notEqual(forged, signature);
  assert.equal(await viem.verifyTypedData({ ...typedData, address, signature: forged }), false);
});
