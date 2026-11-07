// Assembles dist/npm: the npm package "whiteflow-mcp" (the bundled stdio server, no dependencies) that `npx -y
// whiteflow-mcp` runs, with the `mcpName` the official MCP Registry checks against server.json. Run `npm run pack`
// first (it builds dist/bundle). Publish with: npm publish ./dist/npm   (needs your npm login)
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";

const root = new URL("..", import.meta.url);
const at = (p) => new URL(p, root);
const { version } = JSON.parse(readFileSync(at("package.json"), "utf8"));
const server = JSON.parse(readFileSync(at("server.json"), "utf8"));
if (server.version !== version || server.packages[0].version !== version) {
  throw new Error(`server.json says ${server.version}/${server.packages[0].version}; package.json says ${version}`);
}

const out = at("dist/npm/");
rmSync(out, { recursive: true, force: true });
mkdirSync(new URL("server/", out), { recursive: true });
for (const f of ["index.mjs", "sandbox-cli.mjs"]) {
  copyFileSync(at(`dist/bundle/server/${f}`), new URL(`server/${f}`, out));
  chmodSync(new URL(`server/${f}`, out), 0o755);
}
for (const f of ["LICENSE", "THIRD_PARTY_LICENSES", "README.md"]) copyFileSync(at(`dist/bundle/${f}`), new URL(f, out));
writeFileSync(
  new URL("package.json", out),
  JSON.stringify(
    {
      name: "whiteflow-mcp",
      version,
      mcpName: server.name,
      description: server.description,
      type: "module",
      bin: { "whiteflow-mcp": "server/index.mjs", "whiteflow-mcp-sandbox": "server/sandbox-cli.mjs" },
      files: ["server", "LICENSE", "THIRD_PARTY_LICENSES", "README.md"],
      engines: { node: ">=20" },
      license: "MIT",
      homepage: "https://whiteflow.org/mcp",
      repository: { type: "git", url: "git+https://github.com/Vishal4742/whiteflow.git", directory: "packages/mcp" },
      keywords: ["mcp", "model-context-protocol", "payments", "usdt", "whitechain", "whiteflow"],
    },
    null,
    2,
  ) + "\n",
);
process.stdout.write(`wrote dist/npm (whiteflow-mcp ${version}, mcpName ${server.name})\n`);
