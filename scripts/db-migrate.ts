/**
 * Apply lib/db/schema.sql to the Neon database in DATABASE_URL. Idempotent — every
 * table uses CREATE TABLE IF NOT EXISTS, so it's safe to re-run.
 *
 *   npm run db:migrate
 *
 * (No psql needed: statements are split and run through the Neon HTTP client.)
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { neon } from '@neondatabase/serverless';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  const schema = readFileSync(resolve(process.cwd(), 'lib/db/schema.sql'), 'utf8');
  const statements = schema
    .replace(/--.*$/gm, '') // strip line comments (none contain a semicolon)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    await sql.query(stmt);
    console.log('  ok:', stmt.split('\n')[0].slice(0, 64));
  }
  console.log(`\nApplied ${statements.length} statement(s) to Neon.`);
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
