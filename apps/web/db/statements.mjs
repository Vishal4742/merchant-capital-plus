// Splits one db/NNN_*.sql file into single statements, the way db/migrate.mjs sends them to Neon (its HTTP driver runs
// one statement per call) and the tests apply them to PGlite, so the split itself is tested. `--` comments are dropped
// first (a ";" inside a comment would otherwise end a statement). Keep the SQL free of functions, DO blocks and "--" in
// string literals.
export function sqlStatements(text) {
  return text
    .replace(/--.*$/gm, "")
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}
