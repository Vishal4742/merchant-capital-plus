// claude-frontend batch 040: investors can reach the offer book from the landing page (FR-ADV-3), and the landing card
// shows a state the product can be in: a part-funded invoice has 1 investor, because the 2nd investor takes its last
// slot and must buy everything left (lib/server/capital-fund.ts). Run from apps/web: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/landing/Sections.tsx", import.meta.url), "utf8");
const capital = source.slice(source.indexOf("export function Capital()"), source.indexOf("export function", source.indexOf("export function Capital()") + 1));

test("landing: the Capital section links to the offer book", () => {
  assert.match(capital, /href="\/capital"[^>]*>\s*Browse offers\s*</);
});

test("landing: the footer links to the offer book too", () => {
  assert.match(source.slice(source.lastIndexOf("<footer")), /href="\/capital"/);
});

test("landing: a part-funded invoice card has 1 investor, and the text names invoices and advances", () => {
  assert.match(capital, /of 1,000\.00 funded · 1 investor</);
  assert.match(capital, /invoice/i);
  assert.match(capital, /advance/i);
  assert.doesNotMatch(capital, /repay from sales/); // an invoice is repaid by the customer, not from sales
});
