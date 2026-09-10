/**
 * In-process mirror of CreditToken.sol — same eligibility gate, same revert.
 * Lets the demo prove beat 5 (a revoked holder's transfer reverts) with no chain,
 * no deploy, no keys. The live executor writes to the real contract instead; this
 * one writes to memory. Behaviour is kept in parity with the Solidity contract.
 */

export type ControlListErrorCode = 'FromNotEligible' | 'ToNotEligible' | 'NotAgent';

export class ControlListError extends Error {
  constructor(public code: ControlListErrorCode, public address?: string) {
    super(address ? `${code}(${address})` : code);
    this.name = 'ControlListError';
  }
}

const norm = (a: string) => a.toLowerCase();

export class InMemoryControlList {
  private eligible = new Map<string, boolean>();
  private balances = new Map<string, bigint>();

  constructor(public agent: string) {
    this.agent = norm(agent);
  }

  private assertAgent(caller: string): void {
    if (norm(caller) !== this.agent) throw new ControlListError('NotAgent');
  }

  setEligible(caller: string, holder: string, value: boolean): void {
    this.assertAgent(caller);
    this.eligible.set(norm(holder), value);
  }

  revoke(caller: string, holder: string): void {
    this.assertAgent(caller);
    this.eligible.set(norm(holder), false);
  }

  issue(caller: string, to: string, amount: bigint): void {
    this.assertAgent(caller);
    const a = norm(to);
    this.eligible.set(a, true);
    this.balances.set(a, (this.balances.get(a) ?? 0n) + amount);
  }

  isEligible(holder: string): boolean {
    return this.eligible.get(norm(holder)) ?? false;
  }

  balanceOf(holder: string): bigint {
    return this.balances.get(norm(holder)) ?? 0n;
  }

  /** Gated transfer. Mint/burn are not modelled here — only peer transfers, which
   *  are what beat 5 reverts on. Throws exactly like the contract's _update guard. */
  transfer(from: string, to: string, amount: bigint): void {
    const f = norm(from);
    const t = norm(to);
    if (!this.isEligible(f)) throw new ControlListError('FromNotEligible', f);
    if (!this.isEligible(t)) throw new ControlListError('ToNotEligible', t);
    const fromBal = this.balances.get(f) ?? 0n;
    if (fromBal < amount) throw new Error('insufficient balance');
    this.balances.set(f, fromBal - amount);
    this.balances.set(t, (this.balances.get(t) ?? 0n) + amount);
  }
}
