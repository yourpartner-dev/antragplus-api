import { createOpenAI } from '@ai-sdk/openai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { useEnv } from '../../helpers/env/index.js';

const env = useEnv();

/**
 * Configured OpenAI provider with API key from environment
 */
export const openai = createOpenAI({
  apiKey: env['OPENAI_API_KEY'] as string || '',
});

/**
 * Configured Google Gemini provider with API key from environment
 * Gemini has large context window - perfect for document processing
 */
export const google = createGoogleGenerativeAI({
  apiKey: env['GEMINI_API_KEY'] as string || '',
});
/**
 * Configured Anthropic provider with API key from environment
 */
export const anthropic = createAnthropic({
  apiKey: env['ANTHROPIC_API_KEY'] as string || '',
});

// Export a helper to get the default model
export function getOpenAIModel(modelName?: string): LanguageModel {
  const defaultModel = env['OPENAI_MODEL'] as string || 'gpt-4o-mini';
  return openai(modelName || defaultModel);
}

// Export helper for grant extraction using Gemini
export function getGrantExtractionModel(): LanguageModel {
  const model = env['GEMINI_MODEL'] as string || 'gemini-2.5-pro';
  return google(model);
}

// Export helper for grant matching using Gemini (large context window for documents)
export function getGrantMatchingModel(): LanguageModel {
  const model = env['GEMINI_MODEL'] as string || 'gemini-2.5-flash';
  return google(model);
}

// Export helper for grant matching using Gemini (large context window for documents)
export function applicationCreationModel(): LanguageModel {
  const model = env['ANTRHOPIC_MODEL'] as string || 'claude-opus-4-20250514';
  return anthropic(model);
}