/**
 * Canned console state telling the full demo story, so the console renders something
 * real with no DB and no keys. The live API falls back to this when the DB is empty,
 * so a judge (or you, rehearsing) always sees a populated console.
 *
 * The story, in order: whale scored & issued autonomously; a large applicant escalated
 * to the 2-of-3 quorum; then a holder liquidated -> re-scored below the floor -> revoked
 * -> its transfer reverts (beat 5).
 */
import type { ConsoleState, AuditRow } from '../db/read';
import { ADDR } from '../mock/fixtures';

const PRICE = 2000; // $0.002 in USDC base units

function ts(offsetSec: number): string {
  return new Date(Date.UTC(2026, 8, 11, 12, 0, offsetSec)).toISOString();
}

const audit: AuditRow[] = [
  { type: 'score', payload: { subject: ADDR.whale, value: 72, asOfBlock: 25953800 }, txHash: null, at: ts(1) },
  { type: 'payment', payload: { subject: ADDR.whale, amountUsd: 0.002, route: '/score' }, txHash: '0xpay01', at: ts(2) },
  { type: 'decision', payload: { subject: ADDR.whale, limit: 5000, escalated: false }, txHash: null, at: ts(3) },
  { type: 'execution', payload: { subject: ADDR.whale, action: 'issue' }, txHash: '0xissue01', at: ts(4) },
  { type: 'score', payload: { subject: ADDR.distressed, value: 61, asOfBlock: 25953810 }, txHash: null, at: ts(5) },
  { type: 'decision', payload: { subject: ADDR.distressed, limit: 50000, escalated: true }, txHash: null, at: ts(6) },
  { type: 'skip', payload: { subject: ADDR.whale, reason: 'fresh' }, txHash: null, at: ts(7) },
  { type: 'payment', payload: { subject: ADDR.distressed, amountUsd: 0.002, route: '/score' }, txHash: '0xpay02', at: ts(8) },
  { type: 'score', payload: { subject: ADDR.distressed, value: 41, asOfBlock: 25953900, note: 'liquidated' }, txHash: null, at: ts(9) },
  { type: 'decision', payload: { subject: ADDR.distressed, limit: 0, revokes: true, escalated: false }, txHash: null, at: ts(10) },
  { type: 'execution', payload: { subject: ADDR.distressed, action: 'revoke' }, txHash: '0xrevoke01', at: ts(11) },
].reverse(); // newest first, as the read-model returns

export function demoConsoleState(): ConsoleState {
  return {
    holders: [
      { address: ADDR.whale, units: 5000, eligible: true, limit: 5000, lastScoreId: 1 },
      { address: ADDR.distressed, units: 0, eligible: false, limit: 0, lastScoreId: 3 }, // revoked after liquidation
    ],
    spend: { spentBaseUnits: PRICE * 2, count: 2 },
    decisions: [
      { subject: ADDR.distressed, limit: 0, rationale: 'Score fell to 41 after a liquidation; below the maintenance floor. Revoking eligibility.', state: 'revoked', escalated: false, at: ts(10) },
      { subject: ADDR.distressed, limit: 50000, rationale: '50,000 units requested exceeds the 10,000 autonomous threshold. Escalating to 2-of-3 signers.', state: 'escalated', escalated: true, at: ts(6) },
      { subject: ADDR.whale, limit: 5000, rationale: 'Score 72: mature account, no liquidations, healthy leverage. 5,000 units under threshold — issued autonomously.', state: 'issued', escalated: false, at: ts(3) },
    ],
    audit,
  };
}
