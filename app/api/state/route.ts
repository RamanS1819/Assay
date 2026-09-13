import { NextResponse } from 'next/server';
import { getConsoleState } from '@/lib/db/read';
import { makeSql } from '@/lib/db/client';
import { demoConsoleState } from '@/lib/console/demo-state';

export const dynamic = 'force-dynamic';

/** Live console state from the DB. The demo/placeholder state is only used when NO
 *  database is configured (someone cloned the repo without a .env) or the DB is
 *  unreachable — so a zero-setup clone still renders. A CONNECTED but empty DB (e.g.
 *  right after `db:reset`) shows the real empty state, not the placeholder. */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(demoConsoleState());
  }
  try {
    return NextResponse.json(await getConsoleState(makeSql()));
  } catch {
    return NextResponse.json(demoConsoleState());
  }
}
