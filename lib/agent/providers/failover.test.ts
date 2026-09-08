import { describe, it, expect, vi, afterEach } from 'vitest';
import { FailoverProvider } from './failover';
import { makeUnderwriteProvider } from './index';
import type { UnderwriteProvider, UnderwriteRequest } from '../underwrite';

const req = {} as UnderwriteRequest; // the fake providers ignore it

const ok = (limit: number): UnderwriteProvider => ({ underwrite: vi.fn(async () => ({ limit, rationale: 'ok' })) });
const fail = (): UnderwriteProvider => ({ underwrite: vi.fn(async () => { throw new Error('down'); }) });

describe('FailoverProvider', () => {
  it('returns the first provider that succeeds and does not call later ones', async () => {
    const first = ok(1);
    const second = ok(2);
    expect((await new FailoverProvider([first, second]).underwrite(req)).limit).toBe(1);
    expect(second.underwrite).not.toHaveBeenCalled();
  });

  it('falls through to the next provider on error', async () => {
    const primary = fail();
    const fallback = ok(9);
    expect((await new FailoverProvider([primary, fallback]).underwrite(req)).limit).toBe(9);
    expect(primary.underwrite).toHaveBeenCalledOnce();
  });

  it('throws AggregateError when every provider fails', async () => {
    await expect(new FailoverProvider([fail(), fail()]).underwrite(req)).rejects.toBeInstanceOf(AggregateError);
  });

  it('requires at least one provider', () => {
    expect(() => new FailoverProvider([])).toThrow();
  });
});

describe('makeUnderwriteProvider', () => {
  const orig = process.env.GROQ_API_KEY;
  afterEach(() => {
    if (orig === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = orig;
  });

  it('always returns a failover chain (Ollama present even with no key)', () => {
    delete process.env.GROQ_API_KEY;
    expect(makeUnderwriteProvider()).toBeInstanceOf(FailoverProvider);
  });

  it('includes Groq when the key is set', () => {
    process.env.GROQ_API_KEY = 'x';
    expect(makeUnderwriteProvider()).toBeInstanceOf(FailoverProvider);
  });
});
