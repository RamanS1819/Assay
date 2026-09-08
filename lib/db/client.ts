import { neon } from '@neondatabase/serverless';
import type { Sql } from './stores';

/** Create a Neon SQL client from DATABASE_URL. Works in the Node worker and on Vercel. */
export function makeSql(url = process.env.DATABASE_URL): Sql {
  if (!url) throw new Error('DATABASE_URL not set');
  return neon(url) as unknown as Sql;
}
