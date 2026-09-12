/**
 * Reset the demo tables in Neon so the console starts from a clean slate before a
 * recording. Clears the app's write-side data (holders, decisions, payments, scores,
 * audit, intents, approvals, cursor). Schema is left intact — re-run npm run db:migrate
 * only if tables are missing.
 *
 *   npm run db:reset            prints current row counts (dry run)
 *   npm run db:reset -- --yes   actually truncates
 */
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const TABLES = ['holders', 'decisions', 'payments', 'scores', 'audit', 'payment_intents', 'approvals', 'agent_cursor'];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const sql = neon(url);

  console.log('Current row counts:');
  for (const t of TABLES) {
    try {
      const rows = (await sql.query(`SELECT count(*)::int AS n FROM ${t}`)) as { n: number }[];
      console.log(`  ${t.padEnd(16)} ${rows[0]?.n ?? 0}`);
    } catch {
      console.log(`  ${t.padEnd(16)} (missing — run db:migrate)`);
    }
  }

  if (!process.argv.includes('--yes')) {
    console.log('\nDry run. Re-run with --yes to clear these tables:\n  npm run db:reset -- --yes');
    return;
  }

  // TRUNCATE all at once (RESTART IDENTITY resets serials; CASCADE covers the
  // approvals -> decisions FK). The user-owned demo DB, cleared on explicit request.
  await sql.query(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
  console.log('\nCleared. The console will fall back to the demo state until the next live cycle.');
}

main().catch((err) => {
  console.error('\nFailed:', err);
  process.exit(1);
});
