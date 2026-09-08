/**
 * Provider selection. Builds the underwriting chain from env:
 *   Groq (if GROQ_API_KEY) -> Ollama (always, as local fallback).
 * Gemini plugs in here later, between the two.
 */
import type { UnderwriteProvider } from '../underwrite';
import { GroqProvider } from './groq';
import { OllamaProvider } from './ollama';
import { FailoverProvider } from './failover';

export { GroqProvider, buildMessages, parseContent } from './groq';
export { OllamaProvider } from './ollama';
export { FailoverProvider } from './failover';

export function makeUnderwriteProvider(): UnderwriteProvider {
  const providers: UnderwriteProvider[] = [];
  if (process.env.GROQ_API_KEY) providers.push(new GroqProvider());
  providers.push(new OllamaProvider()); // always available as the local fallback
  return new FailoverProvider(providers);
}
