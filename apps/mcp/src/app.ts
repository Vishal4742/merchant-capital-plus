// The hosted MCP service (batch 058; FR-MCP-1..3, FR-GW-14; SRS-CHANGE FR-MCP-18/19/20 proposed): an Express app with
//  - the OAuth authorization server (the MCP SDK's handlers over PgOAuthProvider): /authorize, /token, /register, /revoke and
//    the RFC 8414 / RFC 9728 discovery documents,
//  - POST /mcp, the Streamable HTTP endpoint, STATELESS: every request is authenticated and gets its own server and
//    transport, so nothing about a merchant outlives a request, any instance can serve any call, and a session id (there is
//    none) could never stand in for a credential,
//  - /health (liveness, touches nothing) and /ready (readiness, checks the database).
// Why a dedicated Node service and not a route in apps/web: the SDK's OAuth handlers are Express, and the tool code lives in
// packages/mcp, which apps/web's production build doesn't import (decided with the owner, 2026-11-07).
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { WhiteflowClient } from "../../../packages/mcp/src/client.ts";
import { PgJournal, type SqlRunner } from "../../../packages/mcp/src/journal-pg.ts";
import { createRemoteServer, type RemoteEvent } from "../../../packages/mcp/src/remote.ts";
import type { Logger } from "../../../packages/mcp/src/safety.ts";
import type { ServiceConfig } from "./config.ts";
import { signAssertion } from "./internal.ts";
import { PgOAuthProvider, SCOPES } from "./provider.ts";

export type { ServiceConfig } from "./config.ts";

export interface AppDeps {
  config: ServiceConfig;
  sql: SqlRunner;
  now?: () => number;
  /** The network the tools call the gateway through (tests script it). */
  gatewayFetch?: typeof globalThis.fetch;
  log: Logger;
}

const MAX_BODY = "1mb";

export function createApp(deps: AppDeps): express.Express {
  const { config, sql, log } = deps;
  const now = deps.now ?? Date.now;
  const gatewayFetch = deps.gatewayFetch ?? globalThis.fetch;
  const provider = new PgOAuthProvider({ sql, config, now });
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1); // behind Vercel's proxy: the rate limiters need the client address from X-Forwarded-For

  app.get("/health", (_req, res) => void res.json({ status: "ok" }));
  app.get("/ready", async (_req, res) => {
    try {
      await sql.query("SELECT 1 AS ok");
      res.json({ status: "ok", database: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable", database: "unavailable" }); // no host, error text or key in diagnostics
    }
  });

  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.issuerUrl,
      baseUrl: config.issuerUrl,
      scopesSupported: [...SCOPES],
      resourceName: "WhiteFlow merchant tools (Whitechain Testnet)",
      resourceServerUrl: config.mcpUrl,
      clientRegistrationOptions: { clientIdGeneration: false },
    }),
  );

  // Origin: a browser page from anywhere else can't drive this endpoint with a user's credentials (DNS rebinding and
  // cross-site calls). A request with no Origin is a server-to-server client (ChatGPT and Claude call from their cloud) and
  // is allowed: Origin is a browser guard, never the authorization, which is the bearer token below.
  const origin = (req: Request, res: Response, next: NextFunction) => {
    const value = req.headers.origin;
    if (value !== undefined && !config.allowedOrigins.includes(value)) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32000, message: "Origin not allowed" }, id: null });
      return;
    }
    next();
  };

  const bearer = requireBearerAuth({ verifier: provider, expectedResource: config.mcpUrl, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(config.mcpUrl) });

  const record = (event: RemoteEvent) =>
    event.type === "tool_ok"
      ? sql.query("UPDATE app_mcp_grants SET last_tool_ok_at = $2, last_error_category = NULL WHERE id = $1 AND revoked_at IS NULL", [event.grantId, now()]).then(() => undefined)
      : event.type === "tool_error"
        ? sql.query("UPDATE app_mcp_grants SET last_error_category = $2 WHERE id = $1 AND revoked_at IS NULL", [event.grantId, event.category]).then(() => undefined)
        : Promise.resolve();

  app.post("/mcp", origin, bearer, express.json({ limit: MAX_BODY }), async (req, res) => {
    const auth = req.auth!;
    const principal = { merchant: String(auth.extra?.merchant), grantId: String(auth.extra?.grantId), scopes: auth.scopes };
    // this request's own credential for the gateway: an assertion for THIS grant and merchant, valid minutes, never the
    // assistant's OAuth token (whose audience is this endpoint, not the gateway)
    const assertion = signAssertion(principal, config.internalSecret, now());
    const client = new WhiteflowClient({ baseUrl: config.webOrigin, apiKey: assertion, fetch: gatewayFetch });
    const server = createRemoteServer({ principal, client, journal: new PgJournal(sql, now), now, log, secrets: [assertion], onEvent: record });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      log.error("mcp request failed", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });

  // stateless: there is no server-to-client stream and no session to end
  const notAllowed = (_req: Request, res: Response) => void res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  return app;
}
