/**
 * Ollama local-fallback provider. Ollama exposes an OpenAI-compatible endpoint,
 * so it reuses the Groq prompt + parser against localhost with no API key. This is
 * the "works with no cloud LLM" tier of the Groq -> Gemini -> Ollama chain.
 */
import type { UnderwriteProvider, UnderwriteRequest } from '../underwrite';
import { buildMessages, parseContent } from './groq';

const DEFAULT_URL = 'http://localhost:11434/v1/chat/completions';
const DEFAULT_MODEL = 'llama3.1';

export class OllamaProvider implements UnderwriteProvider {
  constructor(
    private url = process.env.OLLAMA_URL ?? DEFAULT_URL,
    private model = process.env.OLLAMA_MODEL ?? DEFAULT_MODEL,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async underwrite(req: UnderwriteRequest): Promise<{ limit: number; rationale: string }> {
    const res = await this.fetchFn(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, temperature: 0, stream: false, messages: buildMessages(req) }),
    });
    if (!res.ok) throw new Error(`Ollama failed: ${res.status}`);
    const json = (await res.json()) as any;
    return parseContent(json?.choices?.[0]?.message?.content ?? '');
  }
}
