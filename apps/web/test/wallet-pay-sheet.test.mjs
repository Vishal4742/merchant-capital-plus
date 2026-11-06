// Batch 032 (FR-PAY-16, FR-PAY-7, NFR-6) and its UX review (claude-frontend on PR #34): what the checkout and invoice
// sheets show when this browser's guest is short. A client component can't render in node:test, so the layout is pinned
// in the source (the browser run is round-1/probes/wallet-walk.mjs); the error tones are pure and tested directly.
// Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { FAILED, NOT_FUNDED, WALLET_CANCELLED, WALLET_SHORT, errorTone } = await import("../lib/outcome.ts");
const source = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const walletPay = source("components/WalletPay.tsx");
const guestShort = walletPay.slice(walletPay.indexOf("export function GuestShort"), walletPay.indexOf("// Whether this browser has a wallet"));
const CRYPTO = /\b(sign|signs|signature|gas|wallet|whitechain|chain|WBT|0x)\b/i;
/** The visible words of a JSX fragment: tags, expressions and entities dropped. */
const words = (jsx) => jsx.replace(/<[^>]*>/g, " ").replace(/\{[^}]*\}/g, " ").replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();

test("a short guest: the wallet option leads as the primary button, inside the notice, in both sheets (UX 032 M1)", () => {
  for (const file of ["components/Checkout.tsx", "components/InvoicePay.tsx"]) {
    const sheet = source(file);
    const short = sheet.indexOf('guest.funds === "short"');
    const hold = sheet.indexOf("<HoldButton", short);
    const lead = sheet.slice(short, hold);
    assert.match(lead, /<GuestShort [^>]*>\s*<WalletOption primary /, `${file}: the primary wallet option is the notice's action`);
    // funded (or unknown): the hold leads and the wallet option is the outline one under "or"
    assert.match(sheet.slice(hold), /<WalletOption busy=/, `${file}: the outline wallet option follows the hold`);
  }
  assert.match(walletPay, /primary \? buttonClasses\("primary", "w-full"\) : outline/, "primary: the filled button Hold to pay has");
  assert.match(walletPay, /\{!primary && \(\s*<p aria-hidden="true"[^>]*>\s*or\s*<\/p>/, "no 'or' above the primary option");
});

test("a short guest: one line first, the address and Copy only under a quiet disclosure (NFR-6, UX 032 M2, L5)", () => {
  const line = guestShort.indexOf('<p role="status"');
  const children = guestShort.indexOf("{children}");
  const details = guestShort.indexOf("<details");
  const address = guestShort.indexOf("{shortAddress(address)}");
  assert.ok(line > 0 && line < children && children < details && details < address, "line, then the wallet option, then the disclosure holding the address");
  assert.ok(!/<details[^>]*\bopen\b/.test(guestShort), "the disclosure starts closed");
  assert.match(guestShort, /<CopyButton text=\{address\}/, "Copy copies the full address");
  assert.match(walletPay, /const shortAddress = \(a: Address\) => `\$\{a\.slice\(0, 6\)\}…\$\{a\.slice\(-4\)\}`/);
});

test("the short notice's default view keeps FR-PAY-7's words (no sign, gas, wallet, chain, no address)", () => {
  const status = guestShort.slice(guestShort.indexOf('<p role="status"'), guestShort.indexOf("</p>", guestShort.indexOf('<p role="status"')));
  const summary = guestShort.slice(guestShort.indexOf("<summary"), guestShort.indexOf("</summary>"));
  assert.equal(words(status), "This browser doesn't have test USDT yet, so it can't pay here.");
  assert.equal(words(summary), "Add test USDT to this browser instead ▾");
  assert.equal(CRYPTO.exec(`${words(status)} ${words(summary)}`), null);
});

test("error tones: a demo limit is amber, a cancel plain ink, a failure red (UX 032 L3)", () => {
  assert.equal(errorTone(NOT_FUNDED), "text-warning");
  assert.equal(errorTone(WALLET_SHORT), "text-warning");
  assert.equal(errorTone(WALLET_CANCELLED), "text-ink-muted");
  assert.equal(errorTone(FAILED), "text-critical");
  assert.equal(errorTone("Your wallet couldn't do this. Nothing was charged. Try again."), "text-critical");
  for (const file of ["components/Checkout.tsx", "components/InvoicePay.tsx"]) {
    assert.match(source(file), /<p role="alert" className=\{`text-center text-sm \$\{errorTone\(error\)\}`\}>/, `${file}: centred, toned (L4)`);
  }
});
