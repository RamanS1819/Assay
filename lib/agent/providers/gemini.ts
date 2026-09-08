/**
 * Gemini "spare" provider — the middle tier of Groq -> Gemini -> Ollama. Reuses the
 * shared prompt, mapping it into Gemini's generateContent shape (systemInstruction +
 * contents) and reading the answer back out of candidates[].content.parts[].text.
 */
import type { UnderwriteProvider, UnderwriteRequest } from '../underwrite';
import { buildMessages, parseContent } from './groq';

const DEFAULT_MODEL = 'gemini-1.5-flash';

export class GeminiProvider implements UnderwriteProvider {
  constructor(
    private apiKey = process.env.GEMINI_API_KEY ?? '',
    private model = process.env.GEMINI_MODEL ?? DEFAULT_MODEL,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async underwrite(req: UnderwriteRequest): Promise<{ limit: number; rationale: string }> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY not set');
    const [system, user] = buildMessages(req);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const res = await this.fetchFn(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system.content }] },
        contents: [{ role: 'user', parts: [{ text: user.content }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) throw new Error(`Gemini failed: ${res.status}`);
    const json = (await res.json()) as any;
    return parseContent(json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  }
}
