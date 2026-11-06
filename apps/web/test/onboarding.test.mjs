// claude-frontend checks for the merchant onboarding (lib/onboarding.ts): the network a wallet is asked to add, the
// dashboard's Get started steps, and the plain sentences a failed sign-in shows. Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { toHex } from "viem";
import { whitechainSepolia } from "viem/chains";

const { WHITECHAIN_TESTNET, setupSteps, doneCount, walletProblem, signInProblem, SIGN_IN_WINDOW_MS } = await import("../lib/onboarding.ts");

test("the network a wallet adds is Whitechain testnet as viem knows it, plus the Ankr endpoint our reads use", () => {
  assert.deepEqual(WHITECHAIN_TESTNET, {
    chainId: "0x752",
    chainName: "Whitechain Testnet",
    nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
    rpcUrls: ["https://rpc.testnet.whitechain.io", "https://rpc.ankr.com/whitechain_testnet"],
    blockExplorerUrls: ["https://explorer.testnet.whitechain.io"],
  });
  assert.equal(WHITECHAIN_TESTNET.chainId, toHex(whitechainSepolia.id), "chain 1874, the one sign-in and refunds use");
  assert.deepEqual(WHITECHAIN_TESTNET.nativeCurrency, whitechainSepolia.nativeCurrency);
  assert.equal(WHITECHAIN_TESTNET.rpcUrls[0], whitechainSepolia.rpcUrls.default.http[0]);
  assert.equal(WHITECHAIN_TESTNET.blockExplorerUrls[0], whitechainSepolia.blockExplorers.default.url);
});

const status = (steps) => steps.map((s) => s.status);

test("a brand-new merchant: nothing done, the link step comes first and payment points at creating a link", () => {
  const steps = setupSteps({ links: 0, payments: 0, keys: 0, payHref: null });
  assert.deepEqual(status(steps), ["todo", "todo", "todo", "todo"]);
  assert.equal(doneCount(steps), 0);
  assert.equal(steps[0].actions[0].href, "/merchant/links");
  assert.equal(steps[2].actions[0].href, "/merchant/links", "no link to pay yet");
  assert.match(steps[2].text, /Test USDT: ask the team during the hackathon\./);
  assert.deepEqual(
    steps[3].actions.map((a) => a.href),
    ["/docs", "/merchant/developers"],
  );
});

test("one link: create and share are done together, and payment opens that link", () => {
  const steps = setupSteps({ links: 1, payments: 0, keys: 0, payHref: "/l/CoLdBrEw01" });
  assert.deepEqual(status(steps), ["done", "done", "todo", "todo"]);
  assert.equal(doneCount(steps), 2);
  assert.equal(steps[2].actions[0].href, "/l/CoLdBrEw01");
});

test("a payment counts even when the links can't be read, and a key finishes setup", () => {
  assert.deepEqual(status(setupSteps({ links: null, payments: 1, keys: null, payHref: null })), ["unknown", "unknown", "done", "unknown"]);
  const all = setupSteps({ links: 2, payments: 3, keys: 1, payHref: "/l/CoLdBrEw01" });
  assert.equal(doneCount(all), all.length, "4 of 4: the home collapses it to Setup complete");
});

test("wallet errors become plain sentences: cancelled, a request already open, anything else", () => {
  assert.match(walletProblem({ code: 4001 }, "network"), /You cancelled in your wallet/);
  assert.match(walletProblem({ code: -32002 }, "sign"), /already has a request open/);
  assert.match(walletProblem(new Error("boom"), "network"), /chain ID 1874/, "adding by hand is the way out");
  assert.match(walletProblem(new Error("boom"), "sign"), /Sign-in didn't work/);
  // viem wraps the provider's error, keeping its code on the outer error
  assert.match(walletProblem(Object.assign(new Error("User rejected the request."), { code: 4001 }), "sign"), /Nothing was signed/);
});

test("a failed sign-in answer: too long, the server down (503), or the server's own words", () => {
  assert.equal(signInProblem(401, "Sign-in expired. Try again.", SIGN_IN_WINDOW_MS + 1), "That took too long. Try again.");
  assert.equal(signInProblem(401, "That signature didn't check out. Try again.", 2_000), "That signature didn't check out. Try again.");
  assert.equal(signInProblem(401, "Error: connect ECONNREFUSED 10.0.0.5:5432", 2_000), "Sign-in didn't work. Try again.", "only the verify route's own sentences are shown (security 029 F1)");
  assert.match(signInProblem(503, "Sign-in isn't available right now. Try again in a minute.", 2_000), /down on our side/);
  assert.match(signInProblem(503, undefined, 2_000), /down on our side/, "a 503 with no JSON body (a proxy) reads the same");
  assert.match(signInProblem(500, undefined, 2_000), /Sign-in didn't work/);
});
