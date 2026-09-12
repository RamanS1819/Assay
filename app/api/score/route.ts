import { NextResponse } from 'next/server';
import { gate } from '@/lib/gateway/x402';
import { PRICED_ROUTES } from '@/lib/gateway/routes';
import { makeGatewayConfig, makeFacilitator } from '@/lib/live/x402-gateway';
import { getScore } from '@/lib/scorer/getScore';
import { makeLiveScoreDeps, liveHeadBlock } from '@/lib/live/scorer';
import { makeSql } from '@/lib/db/client';
import { PaymentsRepo, ScoresRepo, AuditRepo } from '@/lib/db/repos';

export const dynamic = 'force-dynamic';

/**
 * The paywalled scorer. GET /api/score?address=0x...
 *   no PAYMENT-SIGNATURE  -> 402 + PAYMENT-REQUIRED header (the price to pay)
 *   valid payment         -> Blocky402 settles the HBAR, then we return the score
 *
 * On a settled payment we record the receipt + score to Neon, so the console's
 * "agent spend today" and audit feed reflect real, paid queries.
 */
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get('address')?.toLowerCase();
  if (!address || !/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ error: 'valid ?address=0x... required' }, { status: 400 });
  }

  const cfg = makeGatewayConfig();
  const result = await gate(req.headers.get('payment-signature'), PRICED_ROUTES.score, cfg, makeFacilitator());

  if (result.status === 402) {
    return NextResponse.json(
      { error: 'payment required', price: PRICED_ROUTES.score.amount, asset: cfg.asset, payTo: cfg.payTo },
      { status: 402, headers: { 'payment-required': result.requiredHeader } },
    );
  }
  if (result.status === 400) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }

  // Paid. Compute the score on live data.
  const atBlock = await liveHeadBlock();
  const score = await getScore(address, { atBlock, chain: 'ethereum' }, makeLiveScoreDeps());

  // Record the paid query so the console goes real (best-effort; a DB blip must not
  // swallow a score the buyer already paid for).
  try {
    const sql = makeSql();
    const now = new Date().toISOString();
    await new ScoresRepo(sql).save(score);
    await new PaymentsRepo(sql).save({ txHash: result.txHash, amount: PRICED_ROUTES.score.amount, route: '/score', subject: address });
    await new AuditRepo(sql).append({ type: 'payment', txHash: result.txHash, amountUsd: 0.002, route: '/score', subject: address, at: now });
    await new AuditRepo(sql).append({ type: 'score', subject: address, value: score.value, asOfBlock: score.asOfBlock, at: now });
  } catch (err) {
    console.error('[/api/score] failed to record paid query:', err);
  }

  const settlement = Buffer.from(JSON.stringify({ txHash: result.txHash })).toString('base64');
  return NextResponse.json(score, { headers: { 'x-payment-response': settlement } });
}
