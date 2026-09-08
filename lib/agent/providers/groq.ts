/**
 * Groq underwriting provider — OpenAI-compatible chat completions in JSON mode.
 * Implements UnderwriteProvider; the loop's underwrite() wrapper clamps whatever
 * this returns, so a bad model response can never over-issue.
 *
 * buildMessages() and parseContent() are pure and unit-tested. underwrite() takes
 * an injectable fetch, so the adapter is testable end-to-end with a mock response.
 */
import type { UnderwriteProvider, UnderwriteRequest } from '../underwrite';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export function buildMessages(req: UnderwriteRequest): ChatMessage[] {
  const system = [
    'You are a credit underwriter for an autonomous agent.',
    'You are given a deterministic 0-100 counterparty score and its subscores. You do NOT recompute the score.',
    'Decide a credit limit in units between 0 and maxLimitUnits, and write a one-sentence rationale citing specific subscores.',
    'A score below 40 should generally be denied (limit 0). Never exceed maxLimitUnits.',
    'Return ONLY a JSON object: {"limit": <number>, "rationale": <string>}.',
  ].join(' ');
  const user = JSON.stringify({
    score: req.score.value,
    subscores: req.score.subscores,
    exposureUnits: req.exposureUnits,
    requestedUnits: req.requestedUnits,
    maxLimitUnits: req.maxLimitUnits,
    quorumThresholdUnits: req.policy.quorumThresholdUnits,
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** Parse the model's content into { limit, rationale }. Tolerates ```json fences;
 *  throws on non-JSON so underwrite() falls back to the deterministic baseline. */
export function parseContent(content: string): { limit: number; rationale: string } {
  let text = content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) text = fenced[1].trim();
  const obj = JSON.parse(text);
  return { limit: Number(obj.limit), rationale: String(obj.rationale ?? '') };
}

export class GroqProvider implements UnderwriteProvider {
  constructor(
    private apiKey = process.env.GROQ_API_KEY ?? '',
    private model = process.env.GROQ_MODEL ?? DEFAULT_MODEL,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async underwrite(req: UnderwriteRequest): Promise<{ limit: number; rationale: string }> {
    if (!this.apiKey) throw new Error('GROQ_API_KEY not set');
    const res = await this.fetchFn(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: buildMessages(req),
      }),
    });
    if (!res.ok) throw new Error(`Groq failed: ${res.status}`);
    const json = (await res.json()) as any;
    return parseContent(json?.choices?.[0]?.message?.content ?? '');
  }
}

/** Pick a provider by env. Groq is implemented; Gemini/Ollama follow the same interface. */
export function makeUnderwriteProvider(kind = process.env.LLM_PROVIDER ?? 'groq'): UnderwriteProvider {
  switch (kind) {
    case 'groq':
      return new GroqProvider();
    default:
      throw new Error(`LLM provider "${kind}" not implemented yet (groq available; gemini/ollama plug into the same interface)`);
  }
}
