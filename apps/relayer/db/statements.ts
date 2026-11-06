// Splits one db/NNN_*.sql file into single statements, the way db/migrate.ts sends them to Neon (its HTTP driver runs
// one statement per call) and the tests apply them to PGlite, so the split itself is tested. The same rule as
// apps/web/db/statements.mjs (the relayer deploys alone, so it can't import it): `--` comments are dropped first, then
// the text is split on ";" at a line end. Keep the SQL free of functions, DO blocks and "--" in string literals.
export function sqlStatements(text: string): string[] {
  return text
    .replace(/--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** The schema files db/migrate.ts applies (and the tests apply the same way): db/NNN_*.sql in name order, except the
 *  owner-run role files (*_role*.sql: they create and grant to the relayer's own login role, need the owner, and 002
 *  uses a DO block the splitter can't split). Batch 049. */
export const isSchemaFile = (name: string): boolean => /^\d{3}_.+\.sql$/.test(name) && !/_role/.test(name);
