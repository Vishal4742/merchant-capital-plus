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

/** Owner-run role files (batch 049): db/NNN_relayer_role*.sql create and grant to the relayer's own login role, need
 *  the owner, and 002 uses a DO block the splitter can't split. One anchored pattern for migrate, tests and harnesses
 *  (review 049 L2): a schema file can't be skipped by having "_role" somewhere in its name. */
export const isRoleFile = (name: string): boolean => /^\d{3}_relayer_role(_[a-z0-9]+)*\.sql$/.test(name);
/** The schema files db/migrate.ts applies (and the tests apply the same way): db/NNN_*.sql in name order, minus role files. */
export const isSchemaFile = (name: string): boolean => /^\d{3}_[a-z0-9_]+\.sql$/.test(name) && !isRoleFile(name);
