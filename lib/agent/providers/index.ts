/**
 * Provider selection. Builds the underwriting chain from env:
 *   Groq (if GROQ_API_KEY) -> Ollama (always, as local fallback).
 * Gemini plugs in here later, between the two.
 */
import type { UnderwriteProvider } from '../underwrite';
import { GroqProvider } from './groq';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import { FailoverProvider } from './failover';

export { GroqProvider, buildMessages, parseContent } from './groq';
export { GeminiProvider } from './gemini';
export { OllamaProvider } from './ollama';
export { FailoverProvider } from './failover';

/** Chain: Groq (if key) -> Gemini (if key) -> Ollama (always, local fallback). */
export function makeUnderwriteProvider(): UnderwriteProvider {
  const providers: UnderwriteProvider[] = [];
  if (process.env.GROQ_API_KEY) providers.push(new GroqProvider());
  if (process.env.GEMINI_API_KEY) providers.push(new GeminiProvider());
  providers.push(new OllamaProvider()); // always available as the local fallback
  return new FailoverProvider(providers);
}
