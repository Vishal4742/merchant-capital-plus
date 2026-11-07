# @merchant-capital/mcp

A local MCP server (stdio) that lets Claude work with your Merchant Capital+ account: create a checkout, check whether it was paid, list payments, and total your sales. It uses your own `sk_test_` key and calls only the public gateway API. With a second, optional key it can also pay a checkout from a test wallet, under hard limits.

Whitechain testnet only. Adapted from [Pixa](https://github.com/soumyacodes007/Pixa) (MIT); see `THIRD_PARTY_LICENSES`.

## Setup

Needs Node 22.18 or newer (it runs the TypeScript directly, no build step).

```bash
cd packages/mcp && npm ci
```

Get a secret key from the Developers screen of the dashboard (it starts `sk_test_`).

## Claude Code

From the repo root:

```bash
claude mcp add merchant-capital --transport stdio --env MCP_SECRET_KEY=sk_test_YOUR_KEY --env MCP_PAYER_KEY=0xYOUR_TEST_WALLET_KEY -- node "$PWD/packages/mcp/src/index.ts"
```

Leave out `--env MCP_PAYER_KEY=…` if Claude should only read and create checkouts. Keep the default scope (`local`, stored in `~/.claude.json`). Don't use `--scope project`: that writes your keys into `.mcp.json` inside the repo.

Then ask things like "make a 5 USD checkout for a coffee", "was it paid?", or "what did I sell this week?".

## Claude Desktop

Add this to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/`), with the absolute path to your checkout of this repo, and restart Claude Desktop:

```json
{
  "mcpServers": {
    "merchant-capital": {
      "command": "node",
      "args": ["/absolute/path/to/merchant-capital-plus/packages/mcp/src/index.ts"],
      "env": {
        "MCP_SECRET_KEY": "sk_test_YOUR_KEY",
        "MCP_PAYER_KEY": "0xYOUR_TEST_WALLET_KEY"
      }
    }
  }
}
```

If Claude Desktop finds an older `node`, put the full path from `which node` in `command`.

## Tools

| Tool | What it does | Moves money? |
|---|---|---|
| `create_checkout` | amount, currency (USDT, USD, EUR, GBP, INR, AED, SGD), optional description of up to 40 characters → the hosted checkout URL to send the customer | No |
| `get_checkout` | id or URL → status (open, pending, paid, expired), amount, and once paid the tx hash with its explorer link | No |
| `list_payments` | the latest 1 to 100 payments: amount, refunded, reference, time, explorer link | No |
| `sales_summary` | from, to (UTC days, both included) → gross, refunded, net and count | No |
| `pay_checkout` | checkout URL → pays it from the `MCP_PAYER_KEY` wallet, gasless | **Yes**, only with `MCP_PAYER_KEY` |
| `spending_report` | every payment `pay_checkout` made, today's total, the limits, each tx hash | No, only with `MCP_PAYER_KEY` |

No tool refunds, withdraws, or changes keys, wallets or webhooks. The keys never appear in a tool's output or error: anything that echoes one shows `[redacted]`.

## Paying checkouts (`MCP_PAYER_KEY`)

Use a throwaway test wallet holding a little test USDT. It needs no WBT, since the gateway's relayer pays the gas.

- `pay_checkout` signs the same USDT authorization the checkout page signs in the browser. The amount, shop and order come from the gateway's own checkout page, never from the conversation. The URL has to be on `MCP_BASE_URL`, and the contract it pays has to be Merchant Capital+'s MerchantPay.
- Limits: 10 USDT per payment and 25 USDT per UTC day by default. `MCP_MAX_PER_PAYMENT` and `MCP_MAX_PER_DAY` change them, up to 100 USDT each; the server refuses to start above that.
- A payment is recorded before it is sent. If the gateway refuses it, it doesn't count. If there's no clear answer, it counts against the day and is never retried: check it with `get_checkout` before paying again.
- The record lives in `~/.config/merchant-capital-mcp/spending.json` (or under `$XDG_CONFIG_HOME`). If that file is damaged, payments stop until you fix it or move it aside.

## Environment

| Variable | Default | |
|---|---|---|
| `MCP_SECRET_KEY` | none | your `sk_test_` key; turns on the merchant tools |
| `MCP_PAYER_KEY` | none | a test wallet's private key (`0x` + 64 hex); turns on the payer tools |
| `MCP_BASE_URL` | `https://whiteflow-app.vercel.app` | the gateway (https; http only for localhost) |
| `MCP_MAX_PER_PAYMENT` | `10` | USDT, at most 100 |
| `MCP_MAX_PER_DAY` | `25` | USDT, at most 100 |

At least one of the two keys must be set.

## Development

```bash
npm run typecheck && npm test
```

The tests run offline against a scripted `fetch` and an in-memory MCP client. `test/fixtures/checkout-live.html` is a real checkout page, kept so the page reader is tested against the format the gateway actually serves.
