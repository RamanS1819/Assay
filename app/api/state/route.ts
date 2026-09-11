import { NextResponse } from 'next/server';
import { getConsoleState } from '@/lib/db/read';
import { makeSql } from '@/lib/db/client';
import { demoConsoleState } from '@/lib/console/demo-state';

export const dynamic = 'force-dynamic';

/** Live console state from the DB; falls back to the demo state when the DB is
 *  absent, unreachable, or empty — so the console is never blank. */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json(demoConsoleState());
  }
  try {
    const state = await getConsoleState(makeSql());
    if (state.holders.length === 0 && state.audit.length === 0) {
      return NextResponse.json(demoConsoleState());
    }
    return NextResponse.json(state);
  } catch {
    return NextResponse.json(demoConsoleState());
  }
}
