'use client';

import { useEffect, useState } from 'react';
import type { ConsoleState, AuditRow } from '@/lib/db/read';

const short = (a: string) => (a && a.startsWith('0x') && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
// EVM hashes (issue/revoke) pass through; Hedera tx ids "0.0.X@sec.nanos" need dashes.
const hashscan = (tx: string) => {
  const m = tx.match(/^(\d+\.\d+\.\d+)@(\d+)\.(\d+)$/);
  return `https://hashscan.io/testnet/transaction/${m ? `${m[1]}-${m[2]}-${m[3]}` : tx}`;
};

function describe(row: AuditRow): string {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const subj = p.subject ? short(String(p.subject)) : '';
  switch (row.type) {
    case 'score':
      return `${subj} scored ${p.value}${p.note ? ` (${p.note})` : ''} @ block ${p.asOfBlock}`;
    case 'payment':
      return `${subj} paid $${p.amountUsd} for ${p.route}`;
    case 'decision':
      return `${subj} → limit ${p.limit}${p.revokes ? ' · REVOKE' : ''}${p.escalated ? ' · escalated' : ''}`;
    case 'execution':
      return `${subj} · ${String(p.action).toUpperCase()} on-chain`;
    case 'skip':
      return `${subj} skipped (${p.reason})`;
    case 'error':
      return `${p.source}: ${p.message}`;
    default:
      return JSON.stringify(p);
  }
}

export default function Console() {
  const [state, setState] = useState<ConsoleState | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch('/api/state')
        .then((r) => r.json())
        .then((s) => alive && setState(s))
        .catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const spentUsd = state ? state.spend.count * 0.002 : 0;
  const cap = 5;

  return (
    <div className="wrap">
      <header>
        <div>
          <h1>
            <span>ASSAY</span> · AUTONOMOUS CREDIT BUREAU
          </h1>
          <div className="sub">pay-per-query onchain credit scoring · agent-underwritten credit line</div>
        </div>
        <div className="meter">
          <div className="muted">
            agent spend · {state?.spend.count ?? 0} queries
          </div>
          <div>
            ${spentUsd.toFixed(3)} <span className="muted">/ ${cap.toFixed(2)}</span>
          </div>
          <div className="bar">
            <div className="fill" style={{ width: `${Math.min(100, (spentUsd / cap) * 100)}%` }} />
          </div>
        </div>
      </header>

      <div className="grid">
        <div className="panel">
          <h2>Holder register</h2>
          <table>
            <thead>
              <tr>
                <th>Address</th>
                <th className="num">Units</th>
                <th className="num">Limit</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(state?.holders ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">No credit lines yet — run the agent to issue one.</td>
                </tr>
              ) : (
                (state?.holders ?? []).map((h) => (
                  <tr key={h.address}>
                    <td className="addr">{short(h.address)}</td>
                    <td className="num">{h.units.toLocaleString()}</td>
                    <td className="num">{h.limit.toLocaleString()}</td>
                    <td>
                      <span className={`badge ${h.eligible ? 'eligible' : 'revoked'}`}>
                        {h.eligible ? 'ELIGIBLE' : 'REVOKED'}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <h2>Underwriting decisions</h2>
          <table>
            <tbody>
              {(state?.decisions ?? []).length === 0 && (
                <tr>
                  <td className="muted">No decisions yet — the agent hasn't underwritten anyone.</td>
                </tr>
              )}
              {(state?.decisions ?? []).map((d, i) => (
                <tr key={i}>
                  <td>
                    <div>
                      <span className="addr">{short(d.subject)}</span>{' '}
                      <span className={`badge ${d.state}`}>{d.state.toUpperCase()}</span>{' '}
                      <span className="muted">limit {d.limit.toLocaleString()}</span>
                    </div>
                    <div className="rationale">{d.rationale}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel feed">
        <h2>Audit trail</h2>
        <table>
          <tbody>
            {(state?.audit ?? []).length === 0 && (
              <tr>
                <td className="muted" colSpan={3}>No activity yet — run a query to begin.</td>
              </tr>
            )}
            {(state?.audit ?? []).map((row, i) => (
              <tr key={i}>
                <td style={{ width: 100 }}>
                  <span className={`badge ${row.type}`}>{row.type}</span>
                </td>
                <td>{describe(row)}</td>
                <td style={{ width: 120 }} className="num">
                  {row.txHash ? (
                    <a href={hashscan(row.txHash)} target="_blank" rel="noreferrer">
                      {short(row.txHash)}
                    </a>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
