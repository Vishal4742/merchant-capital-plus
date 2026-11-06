// The whole packaging workflow, from a clean checkout after `npm ci`: build → stage → mcpb validate → mcpb pack →
// mcpb info → checksums. Output: dist/whiteflow.mcpb, dist/whiteflow.mcpb.sha256 (the archive's bytes) and
// dist/whiteflow.mcpb.contents.sha256 (its files' bytes: reproducible across runs, unlike the archive, because
// mcpb 2.1.2 stamps each zip entry with the current time, dist/cli/pack.js line 171).
// Usage: node scripts/pack.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServer, bundleDir, root } from "./build.mjs";
import { manifestText } from "./manifest.mjs";

export const archive = join(root, "dist", "whiteflow.mcpb");
// a direct devDependency, so npm ci puts it here (its package.json isn't in its "exports", so no require.resolve)
const mcpbDir = join(root, "node_modules", "@anthropic-ai", "mcpb");
const mcpbCli = join(mcpbDir, JSON.parse(readFileSync(join(mcpbDir, "package.json"), "utf8")).bin.mcpb ?? "dist/cli/cli.js");

function mcpb(...args) {
  const run = spawnSync(process.execPath, [mcpbCli, ...args], { cwd: root, encoding: "utf8" });
  const out = `${run.stdout}${run.stderr}`.trim();
  if (run.status !== 0 || /ERROR/.test(out)) throw new Error(`mcpb ${args[0]} failed:\n${out}`);
  return out;
}

const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
const sha256 = (data) => createHash("sha256").update(data).digest("hex");

export async function pack() {
  const manifest = await manifestText();
  if (readFileSync(join(root, "manifest.json"), "utf8").replace(/\r\n/g, "\n") !== manifest) throw new Error("manifest.json is out of date: run npm run manifest and commit it.");
  await buildServer();
  writeFileSync(join(bundleDir, "manifest.json"), manifest);
  copyFileSync(join(root, "icon.png"), join(bundleDir, "icon.png"));
  copyFileSync(join(root, "README.md"), join(bundleDir, "README.md"));
  copyFileSync(join(root, "..", "..", "LICENSE"), join(bundleDir, "LICENSE"));

  const validated = mcpb("validate", join(bundleDir, "manifest.json"));
  const packed = mcpb("pack", bundleDir, archive);
  const info = mcpb("info", archive);

  const files = walk(bundleDir).map((f) => relative(bundleDir, f).replaceAll("\\", "/")).sort();
  const contents = sha256(files.map((f) => `${f}\0${sha256(readFileSync(join(bundleDir, f)))}\n`).join(""));
  const digest = sha256(readFileSync(archive));
  writeFileSync(`${archive}.sha256`, `${digest}  whiteflow.mcpb\n`);
  writeFileSync(`${archive}.contents.sha256`, `${contents}  whiteflow.mcpb contents (${files.length} files: ${files.join(", ")})\n`);
  return { archive, digest, contents, files, validated, packed, info };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await pack();
  process.stdout.write(`${r.validated}\n\n${r.packed}\n\n${r.info}\n\nsha256 ${r.digest}  dist/whiteflow.mcpb\ncontents-sha256 ${r.contents}\nfiles: ${r.files.join(", ")}\n`);
}
