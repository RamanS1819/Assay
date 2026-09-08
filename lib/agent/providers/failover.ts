/**
 * Tries providers in order, returns the first success. Throws only if every one
 * fails. This is the Groq -> Gemini -> Ollama resilience the plan calls for: a
 * flaky cloud LLM never stalls the agent loop while a local fallback is reachable.
 */
import type { UnderwriteProvider, UnderwriteRequest } from '../underwrite';

export class FailoverProvider implements UnderwriteProvider {
  constructor(
    private providers: UnderwriteProvider[],
    private onError?: (provider: string, err: unknown) => void,
  ) {
    if (providers.length === 0) throw new Error('FailoverProvider needs at least one provider');
  }

  async underwrite(req: UnderwriteRequest): Promise<{ limit: number; rationale: string }> {
    const errors: unknown[] = [];
    for (const provider of this.providers) {
      try {
        return await provider.underwrite(req);
      } catch (err) {
        errors.push(err);
        this.onError?.(provider.constructor.name, err);
      }
    }
    throw new AggregateError(errors, 'all underwriting providers failed');
  }
}
