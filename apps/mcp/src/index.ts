// Entry point of the hosted MCP service (batch 058). Reads the environment once; when anything is missing or malformed the
// service answers 503 not_configured to every protocol and OAuth request (liveness stays up so a platform can see the
// process) and logs WHICH settings are wrong, never their values. There is no sandbox mode and no default host.
import { neon } from "@neondatabase/serverless";
import express from "express";
import { createApp } from "./app.ts";
import { parseConfig } from "./config.ts";
import type { SqlRunner } from "../../../packages/mcp/src/journal-pg.ts";
import type { Logger } from "../../../packages/mcp/src/safety.ts";

/** Structured, one JSON object per line; messages are fixed strings plus an error NAME, never request bodies or tokens. */
const log: Logger = {
  info: (message) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level: "info", service: "whiteflow-mcp", message })}\n`),
  error: (message, error) => process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level: "error", service: "whiteflow-mcp", message, error: error instanceof Error ? error.name : error === undefined ? undefined : typeof error })}\n`),
};

function unconfigured(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.get("/health", (_req, res) => void res.json({ status: "ok" }));
  app.use((_req, res) => void res.status(503).json({ error: "not_configured", error_description: "The WhiteFlow connection service isn't set up on this server yet." }));
  return app;
}

function build(): express.Express {
  const result = parseConfig(process.env);
  if (!result.ok) {
    log.error(`not configured: ${result.problems.join("; ")}`);
    return unconfigured();
  }
  const sql = neon(result.databaseUrl);
  const runner: SqlRunner = { query: (text, params) => sql.query(text, params ?? []) as Promise<Record<string, unknown>[]> };
  log.info(`configured for ${result.config.mcpUrl.origin} (Whitechain Testnet)`);
  return createApp({ config: result.config, sql: runner, log });
}

const app = build();
export default app;

// run directly (`npm start`): listen. On a platform that imports the default export, it listens for us.
if (process.argv[1] && /[\\/]index\.(ts|mjs|js)$/.test(process.argv[1]) && !process.env.VERCEL) {
  const port = Number(process.env.PORT ?? 8787);
  app.listen(port, () => log.info(`listening on ${port}`));
}
